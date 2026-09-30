const checkoutService = require('../services/checkoutService');

async function checkout(req, res) {
  const { shipping_address_id: shippingAddressId } = req.body;
  if (!shippingAddressId) {
    return res.status(400).json({ error: 'shipping_address_id is required' });
  }

  const { data: address, error: addressError } = await checkoutService.getAddressForBuyer(
    shippingAddressId,
    req.user.id,
  );
  if (addressError) {
    return res.status(500).json({ error: 'Failed to load address' });
  }
  if (!address) {
    return res.status(400).json({ error: 'Invalid shipping_address_id' });
  }

  const { data, error } = await checkoutService.checkout(req.user.id, address);
  if (error) {
    return res.status(error.status).json({ error: error.message, details: error.details });
  }

  res.status(201).json(data);
}

async function pay(req, res) {
  const { order_id: orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: 'order_id is required' });
  }

  const { data, error } = await checkoutService.createCheckoutSession(req.user.id, orderId);
  if (error) {
    return res.status(error.status).json({ error: error.message });
  }

  res.status(201).json(data);
}

async function sessionStatus(req, res) {
  const { session_id: sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  const { data, error } = await checkoutService.getCheckoutSessionStatus(req.user.id, sessionId);
  if (error) {
    return res.status(error.status).json({ error: error.message });
  }

  res.json(data);
}

module.exports = { checkout, pay, sessionStatus };
