const supabase = require('../lib/db');
const ordersService = require('./ordersService');
const paymentProvider = require('../lib/paymentProvider');

async function handlePaymentFailed(checkoutGroupId) {
  const { data: orders, error } = await ordersService.getOrdersByCheckoutGroup(checkoutGroupId);
  if (error) return { error };

  const pendingOrders = orders.filter((o) => o.status === 'pending_payment');
  if (pendingOrders.length === 0) {
    return { data: { checkout_group_id: checkoutGroupId, result: 'no_pending_orders' } };
  }

  await supabase
    .from('orders')
    .update({ status: 'payment_failed' })
    .in('id', pendingOrders.map((o) => o.id));

  return {
    data: {
      checkout_group_id: checkoutGroupId,
      result: 'payment_failed',
      order_ids: pendingOrders.map((o) => o.id),
    },
  };
}

// This is the atomic decrement point deferred from the buyer-backend step:
// checkout only validated stock, it never touched it. Now that payment has
// actually succeeded, every sibling order in the checkout group is
// re-validated against CURRENT listing state (not the snapshot taken at
// checkout time) before stock is decremented and orders move to 'paid'.
//
// All-or-nothing for the MVP: if any single line item across any sibling
// order is no longer available, the whole group is refunded rather than
// attempting a partial refund for just that line -- simpler and safer to
// reason about with a single payment covering multiple sellers. See
// lib/paymentProvider.js for why refundPayment is a simulation, not a
// real call.
async function handlePaymentSucceeded(checkoutGroupId, sessionId, totalAmount) {
  const { data: orders, error } = await ordersService.getOrdersByCheckoutGroup(checkoutGroupId);
  if (error) return { error };

  const pendingOrders = orders.filter((o) => o.status === 'pending_payment');
  if (pendingOrders.length === 0) {
    return { data: { checkout_group_id: checkoutGroupId, result: 'no_pending_orders' } };
  }

  const allOrderItems = pendingOrders.flatMap((o) => o.order_items.map((oi) => ({ ...oi, orderId: o.id })));
  const listingIds = [...new Set(allOrderItems.map((oi) => oi.listing_id))];

  const { data: listings, error: listingsError } = await supabase
    .from('listings')
    .select('id, status, stock')
    .in('id', listingIds);
  if (listingsError) return { error: listingsError };

  const listingsById = new Map(listings.map((l) => [l.id, l]));
  const orderIds = pendingOrders.map((o) => o.id);

  const unavailable = allOrderItems.filter((oi) => {
    const listing = listingsById.get(oi.listing_id);
    return !listing || listing.status !== 'active' || oi.quantity > listing.stock;
  });

  if (unavailable.length > 0) {
    await paymentProvider.refundPayment(sessionId, { amount: totalAmount });
    await supabase.from('orders').update({ status: 'refunded' }).in('id', orderIds);
    return {
      data: {
        checkout_group_id: checkoutGroupId,
        result: 'refunded',
        reason: 'stock_or_availability_changed',
        unavailable: unavailable.map((oi) => ({ listing_id: oi.listing_id, order_id: oi.orderId })),
      },
    };
  }

  // Guarded decrement: the update only takes effect if stock is still
  // sufficient at write time, protecting against a race between the fresh
  // read above and this write. Not a real DB transaction (supabase-js
  // issues separate REST calls) -- if a later item in this loop fails its
  // guard, whatever stock was already decremented earlier in the same loop
  // is rolled back before falling through to the same refund path above.
  const decremented = [];
  for (const oi of allOrderItems) {
    const listing = listingsById.get(oi.listing_id);
    const { data: updated, error: updateError } = await supabase
      .from('listings')
      .update({ stock: listing.stock - oi.quantity })
      .eq('id', oi.listing_id)
      .gte('stock', oi.quantity)
      .select();

    if (updateError || !updated || updated.length === 0) {
      for (const d of decremented) {
        await supabase.from('listings').update({ stock: d.previousStock }).eq('id', d.listingId);
      }
      await paymentProvider.refundPayment(sessionId, { amount: totalAmount });
      await supabase.from('orders').update({ status: 'refunded' }).in('id', orderIds);
      return {
        data: {
          checkout_group_id: checkoutGroupId,
          result: 'refunded',
          reason: 'stock_changed_during_decrement',
        },
      };
    }

    decremented.push({ listingId: oi.listing_id, previousStock: listing.stock });
  }

  await supabase.from('orders').update({ status: 'paid' }).in('id', orderIds);

  return {
    data: {
      checkout_group_id: checkoutGroupId,
      result: 'paid',
      order_ids: orderIds,
    },
  };
}

module.exports = { handlePaymentFailed, handlePaymentSucceeded };
