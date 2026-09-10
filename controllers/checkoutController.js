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
  const { checkout_group_id: checkoutGroupId } = req.body;
  if (!checkoutGroupId) {
    return res.status(400).json({ error: 'checkout_group_id is required' });
  }

  const { data, error } = await checkoutService.createPaymentSession(req.user.id, checkoutGroupId);
  if (error) {
    return res.status(error.status).json({ error: error.message });
  }

  res.status(201).json(data);
}

module.exports = { checkout, pay };
