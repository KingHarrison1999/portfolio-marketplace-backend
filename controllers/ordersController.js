const ordersService = require('../services/ordersService');

async function getByGroup(req, res) {
  const { data, error } = await ordersService.getOrdersByCheckoutGroup(req.params.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load orders' });
  }

  const visible = req.user.role === 'admin' ? data : data.filter((o) => o.buyer_id === req.user.id);

  if (visible.length === 0) {
    // Don't distinguish "doesn't exist" from "exists but isn't yours".
    return res.status(404).json({ error: 'Checkout group not found' });
  }

  res.json({ orders: visible });
}

async function getMine(req, res) {
  const { data, error } = await ordersService.getOrdersByBuyer(req.user.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load orders' });
  }
  res.json({ orders: data });
}

module.exports = { getByGroup, getMine };
