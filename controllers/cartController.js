const cartService = require('../services/cartService');

async function assertOwnedCartItem(req, res) {
  const { data: item, error } = await cartService.getCartItemWithCart(req.params.id);

  if (error) {
    res.status(500).json({ error: 'Failed to load cart item' });
    return null;
  }
  if (!item) {
    res.status(404).json({ error: 'Cart item not found' });
    return null;
  }
  if (item.cart.buyer_id !== req.user.id) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return item;
}

async function getCart(req, res) {
  const { data, error } = await cartService.getCartWithItems(req.user.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to load cart' });
  }
  res.json(data);
}

async function addItem(req, res) {
  const { listing_id: listingId, quantity } = req.body;
  const qty = Number(quantity);

  if (!listingId || !Number.isInteger(qty) || qty < 1) {
    return res.status(400).json({ error: 'listing_id and a positive integer quantity are required' });
  }

  const { data: listing, error: listingError } = await cartService.getListingForCart(listingId);
  if (listingError) {
    return res.status(500).json({ error: 'Failed to load listing' });
  }
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found' });
  }
  if (listing.status !== 'active') {
    return res.status(400).json({ error: 'Listing is not available for purchase' });
  }

  const { data: cart, error: cartError } = await cartService.getOrCreateCart(req.user.id);
  if (cartError) {
    return res.status(500).json({ error: 'Failed to load cart' });
  }

  const { data: existingItem, error: findError } = await cartService.findCartItem(cart.id, listingId);
  if (findError) {
    return res.status(500).json({ error: 'Failed to check cart' });
  }

  const requestedTotal = (existingItem ? existingItem.quantity : 0) + qty;
  if (requestedTotal > listing.stock) {
    return res.status(400).json({ error: 'Requested quantity exceeds available stock' });
  }

  if (existingItem) {
    const { data, error } = await cartService.setCartItemQuantity(existingItem.id, requestedTotal);
    if (error) {
      return res.status(500).json({ error: 'Failed to update cart' });
    }
    return res.status(200).json({ item: data });
  }

  const { data, error } = await cartService.addCartItem(cart.id, listingId, qty);
  if (error) {
    return res.status(500).json({ error: 'Failed to add to cart' });
  }
  res.status(201).json({ item: data });
}

async function updateItem(req, res) {
  const item = await assertOwnedCartItem(req, res);
  if (!item) return;

  const qty = Number(req.body.quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }

  const { data: listing, error: listingError } = await cartService.getListingForCart(item.listing_id);
  if (listingError) {
    return res.status(500).json({ error: 'Failed to load listing' });
  }
  if (!listing || listing.status !== 'active') {
    return res.status(400).json({ error: 'Listing is no longer available' });
  }
  if (qty > listing.stock) {
    return res.status(400).json({ error: 'Requested quantity exceeds available stock' });
  }

  const { data, error } = await cartService.setCartItemQuantity(item.id, qty);
  if (error) {
    return res.status(500).json({ error: 'Failed to update cart item' });
  }
  res.json({ item: data });
}

async function removeItem(req, res) {
  const item = await assertOwnedCartItem(req, res);
  if (!item) return;

  const { error } = await cartService.removeCartItem(item.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to remove cart item' });
  }
  res.status(204).send();
}

module.exports = { getCart, addItem, updateItem, removeItem };
