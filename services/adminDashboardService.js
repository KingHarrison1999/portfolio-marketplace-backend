const supabase = require('../lib/db');

async function getUsersByRole() {
  const { data, error } = await supabase.from('profiles').select('role');
  if (error) return { data: null, error };

  const counts = { buyer: 0, seller: 0, admin: 0 };
  for (const row of data) {
    counts[row.role] = (counts[row.role] || 0) + 1;
  }
  return { data: counts, error: null };
}

async function getActiveListingsCount() {
  const { count, error } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');
  return { data: count, error };
}

async function getOrdersByStatus() {
  const { data, error } = await supabase.from('orders').select('status');
  if (error) return { data: null, error };

  const counts = {};
  for (const row of data) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  return { data: counts, error: null };
}

// Sums order_items.commission_amount for orders currently in 'paid' status.
// Labeled provisional in the response -- Optimise Payments is a local
// simulation, not a connected real processor (see step 6), so nothing
// here represents money that has actually changed hands.
async function getProvisionalCommissionRevenue() {
  const { data, error } = await supabase
    .from('order_items')
    .select('commission_amount, orders!inner(status)')
    .eq('orders.status', 'paid');
  if (error) return { data: null, error };

  const total = data.reduce((sum, row) => sum + Number(row.commission_amount), 0);
  return { data: Math.round(total * 100) / 100, error: null };
}

async function getDashboard() {
  const [usersRes, listingsRes, ordersRes, revenueRes] = await Promise.all([
    getUsersByRole(),
    getActiveListingsCount(),
    getOrdersByStatus(),
    getProvisionalCommissionRevenue(),
  ]);

  const firstError = [usersRes, listingsRes, ordersRes, revenueRes].find((r) => r.error)?.error;
  if (firstError) {
    return { data: null, error: firstError };
  }

  return {
    data: {
      users_by_role: usersRes.data,
      active_listings: listingsRes.data,
      orders_by_status: ordersRes.data,
      commission_revenue: {
        amount: revenueRes.data,
        currency: 'GBP',
        status: 'provisional',
        note:
          "Computed from order_items.commission_amount on orders with status='paid'. Not confirmed real revenue -- payment processing (Optimise Payments) is a local simulation, not a connected real processor, so no real payment has actually gone through the system yet.",
      },
    },
    error: null,
  };
}

module.exports = { getDashboard };
