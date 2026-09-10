const supabase = require('../lib/db');

async function getOrdersByCheckoutGroup(checkoutGroupId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('checkout_group_id', checkoutGroupId);
  return { data, error };
}

// Full order history for a buyer's own account pages (account/dashboard.html,
// account/orders.html) -- every order they've ever placed, newest first,
// with each order's line items (rendered from the title_at_purchase/
// price_at_purchase snapshot, same as order-confirmation.html).
async function getOrdersByBuyer(buyerId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });
  return { data, error };
}

module.exports = { getOrdersByCheckoutGroup, getOrdersByBuyer };
