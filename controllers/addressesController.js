const addressesService = require('../services/addressesService');

async function assertOwnedAddress(req, res) {
  const { data: address, error } = await addressesService.getAddressById(req.params.id);

  if (error) {
    res.status(500).json({ error: 'Failed to load address' });
    return null;
  }
  if (!address) {
    res.status(404).json({ error: 'Address not found' });
    return null;
  }
  if (address.user_id !== req.user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return address;
}

async function list(req, res) {
  const { data, error } = await addressesService.getAddressesForUser(req.user.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load addresses' });
  }
  res.json({ addresses: data });
}

async function create(req, res) {
  const { line1, city, postcode, country } = req.body;
  if (!line1 || !city || !postcode || !country) {
    return res.status(400).json({ error: 'line1, city, postcode, and country are required' });
  }

  const { data, error } = await addressesService.createAddress(req.user.id, req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ address: data });
}

async function update(req, res) {
  const address = await assertOwnedAddress(req, res);
  if (!address) return;

  const { data, error } = await addressesService.updateAddress(address.id, req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ address: data });
}

async function remove(req, res) {
  const address = await assertOwnedAddress(req, res);
  if (!address) return;

  const { error } = await addressesService.deleteAddress(address.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to delete address' });
  }
  res.status(204).send();
}

module.exports = { list, create, update, remove };
