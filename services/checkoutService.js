const crypto = require('crypto');
const supabase = require('../lib/db');
const cartService = require('./cartService');
const ordersService = require('./ordersService');
const paymentProvider = require('../lib/paymentProvider');
const emailNotificationService = require('./emailNotificationService');

const TIER_RATE_FIELD = { individual: 'flat_rate', business: 'business_rate', charity: 'charity_rate' };

async function getCommissionSettings() {
  const { data, error } = await supabase
    .from('commission_settings')
    .select('flat_rate, business_rate, charity_rate')
    .limit(1)
    .maybeSingle();
  return { data, error };
}

async function getSellerCommissionProfiles(sellerIds) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, commission_tier, commission_tier_verified')
    .in('id', sellerIds);
  return { data, error };
}

// The rate actually charged for one seller's line items. 'individual' (the
// default, no discount claimed) always uses flat_rate -- there's nothing to
// verify there. A self-declared 'business'/'charity' only gets its
// configured rate once an admin has verified the claim
// (commission_tier_verified); until then, or if the tier's rate hasn't
// been configured yet (business_rate/charity_rate are nullable with no
// default -- see 20260903144300_commission_settings_tiers.sql), it falls
// back to flat_rate rather than failing checkout or charging 0% commission.
function rateForSeller(settings, sellerProfile) {
  const flatRate = Number(settings.flat_rate);
  if (!sellerProfile) return flatRate;

  const { commission_tier: tier, commission_tier_verified: verified } = sellerProfile;
  if (tier === 'individual' || !verified) return flatRate;

  const field = TIER_RATE_FIELD[tier];
  const rate = field ? settings[field] : null;
  return rate !== null && rate !== undefined ? Number(rate) : flatRate;
}

async function getAddressForBuyer(addressId, buyerId) {
  const { data, error } = await supabase
    .from('addresses')
    .select('*')
    .eq('id', addressId)
    .eq('user_id', buyerId)
    .maybeSingle();
  return { data, error };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function rollbackOrders(orderIds) {
  if (orderIds.length === 0) return;
  // order_items cascade-deletes with its parent order, so deleting the
  // orders is enough.
  await supabase.from('orders').delete().in('id', orderIds);
}

// Stock is validated here but deliberately NOT decremented -- there's no
// reservation/expiry mechanism in this codebase yet, and payment isn't
// wired up until the next step, so every 'pending_payment' order created
// right now would never convert to 'paid'. Decrementing at this point
// would permanently lock up stock behind orders that can never complete.
// The payment-confirmation step should decrement stock (and should
// re-validate it at that point too, since availability can change between
// checkout initiation and payment).
//
// A cart can span multiple sellers. Each seller needs an independently
// computable payout and commission, so checkout produces one order PER
// SELLER -- each with its own order_items, its own total, and its own
// commission -- rather than a single order spanning every seller in the
// cart. All sibling orders from one checkout share the same buyer,
// shipping address, and checkout_group_id, so they can be retrieved,
// paid, and confirmed together as one checkout event even though each is
// an independent row.
async function checkout(buyerId, shippingAddress) {
  const shippingAddressId = shippingAddress.id;
  const { data: cartData, error: cartError } = await cartService.getCartWithItems(buyerId);
  if (cartError) {
    return { error: { status: 500, message: 'Failed to load cart' } };
  }

  const { cart, items } = cartData;

  if (!items || items.length === 0) {
    return { error: { status: 400, message: 'Cart is empty' } };
  }

  const unavailable = items.filter(
    (item) => !item.listing || item.listing.status !== 'active' || item.quantity > item.listing.stock,
  );
  if (unavailable.length > 0) {
    return {
      error: {
        status: 400,
        message: 'One or more items in your cart are no longer available in the requested quantity',
        details: unavailable.map((item) => ({ cart_item_id: item.id, listing_id: item.listing?.id ?? null })),
      },
    };
  }

  const { data: commissionSettings, error: commissionError } = await getCommissionSettings();
  if (commissionError || !commissionSettings) {
    return { error: { status: 500, message: 'Failed to load commission settings' } };
  }

  const sellerIds = [...new Set(items.map((item) => item.listing.seller_id))];
  const { data: sellerProfiles, error: sellerProfilesError } = await getSellerCommissionProfiles(sellerIds);
  if (sellerProfilesError) {
    return { error: { status: 500, message: 'Failed to load seller commission tiers' } };
  }
  const sellerProfileById = new Map(sellerProfiles.map((p) => [p.id, p]));

  const lineItems = items.map((item) => {
    const priceAtPurchase = Number(item.listing.price);
    const lineTotal = round2(priceAtPurchase * item.quantity);
    const rate = rateForSeller(commissionSettings, sellerProfileById.get(item.listing.seller_id));
    const commissionAmount = round2(lineTotal * rate);
    return {
      listing_id: item.listing.id,
      seller_id: item.listing.seller_id,
      quantity: item.quantity,
      price_at_purchase: priceAtPurchase,
      title_at_purchase: item.listing.title,
      commission_amount: commissionAmount,
      line_total: lineTotal,
    };
  });

  const lineItemsBySeller = new Map();
  for (const li of lineItems) {
    if (!lineItemsBySeller.has(li.seller_id)) {
      lineItemsBySeller.set(li.seller_id, []);
    }
    lineItemsBySeller.get(li.seller_id).push(li);
  }

  const checkoutGroupId = crypto.randomUUID();
  const createdOrders = [];

  for (const [sellerId, sellerLineItems] of lineItemsBySeller) {
    // What the buyer pays this seller -- the sum of listed prices for that
    // seller's lines. commission_amount is the platform's cut of each
    // line, taken from the seller's payout, not an extra charge added on
    // top of what the buyer sees.
    const total = round2(sellerLineItems.reduce((sum, li) => sum + li.line_total, 0));

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        buyer_id: buyerId,
        total,
        status: 'pending_payment',
        shipping_address_id: shippingAddressId,
        // Snapshot, same reasoning as order_items.title_at_purchase --
        // editing or deleting the address later must not change what a
        // past order shows.
        shipping_line1: shippingAddress.line1,
        shipping_line2: shippingAddress.line2,
        shipping_city: shippingAddress.city,
        shipping_postcode: shippingAddress.postcode,
        shipping_country: shippingAddress.country,
        checkout_group_id: checkoutGroupId,
      })
      .select()
      .single();

    if (orderError) {
      await rollbackOrders(createdOrders.map((o) => o.id));
      return { error: { status: 500, message: 'Failed to create order' } };
    }

    const orderItemsPayload = sellerLineItems.map((li) => ({
      order_id: order.id,
      listing_id: li.listing_id,
      seller_id: li.seller_id,
      quantity: li.quantity,
      price_at_purchase: li.price_at_purchase,
      title_at_purchase: li.title_at_purchase,
      commission_amount: li.commission_amount,
    }));

    const { data: orderItems, error: orderItemsError } = await supabase
      .from('order_items')
      .insert(orderItemsPayload)
      .select();

    if (orderItemsError) {
      // No multi-statement transaction here (supabase-js issues separate
      // REST calls) -- roll back this order plus any earlier orders
      // already created in this same checkout, rather than leaving a
      // partially-split checkout behind.
      await rollbackOrders([...createdOrders.map((o) => o.id), order.id]);
      return { error: { status: 500, message: 'Failed to create order items' } };
    }

    createdOrders.push({ ...order, order_items: orderItems });
  }

  await supabase.from('cart_items').delete().eq('cart_id', cart.id);

  // One order-received email to the buyer and one new-order email to the
  // seller, per order (each order already belongs to exactly one seller).
  // Email failures -- including "not configured", the current reality --
  // must never fail checkout itself; it's a side effect, not part of the
  // transaction.
  for (const order of createdOrders) {
    try {
      await emailNotificationService.sendOrderReceivedEmail(order);
    } catch {
      // swallow -- see comment above
    }
    try {
      await emailNotificationService.sendNewOrderEmailToSeller(order);
    } catch {
      // swallow -- see comment above
    }
  }

  return { data: { checkout_group_id: checkoutGroupId, orders: createdOrders }, error: null };
}

// Creates a hosted checkout session covering every still-payable
// (pending_payment) sibling order in the group -- one payment for however
// many per-seller orders resulted from the checkout. See
// lib/paymentProvider.js for why this is a simulation rather than a real
// call to Optimise Payments.
async function createPaymentSession(buyerId, checkoutGroupId) {
  const { data: orders, error } = await ordersService.getOrdersByCheckoutGroup(checkoutGroupId);
  if (error) {
    return { error: { status: 500, message: 'Failed to load orders' } };
  }

  const ownOrders = orders.filter((o) => o.buyer_id === buyerId);
  if (ownOrders.length === 0) {
    return { error: { status: 404, message: 'Checkout group not found' } };
  }

  const payableOrders = ownOrders.filter((o) => o.status === 'pending_payment');
  if (payableOrders.length === 0) {
    return { error: { status: 400, message: 'No orders in this checkout group are awaiting payment' } };
  }

  const totalAmount = round2(payableOrders.reduce((sum, o) => sum + Number(o.total), 0));

  const session = await paymentProvider.createPayment({
    amount: totalAmount,
    currency: 'GBP',
    reference: checkoutGroupId,
  });

  await supabase
    .from('orders')
    .update({ payment_reference: session.session_id })
    .in(
      'id',
      payableOrders.map((o) => o.id),
    );

  return {
    data: {
      checkout_group_id: checkoutGroupId,
      amount: session.amount,
      currency: session.currency,
      session_id: session.session_id,
      redirect_url: session.redirect_url,
      payment_connected: false,
      message:
        'Payments are not connected yet in this demo -- there is no real payment provider behind this. ' +
        'This session is simulated so the rest of the order flow (confirmation, stock updates, order history) ' +
        'can still be tested end-to-end.',
    },
    error: null,
  };
}

module.exports = { checkout, getAddressForBuyer, createPaymentSession };
