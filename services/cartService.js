const supabase = require('../lib/db');

async function getOrCreateCart(buyerId) {
  const { data: existing, error: fetchError } = await supabase
    .from('cart')
    .select('*')
    .eq('buyer_id', buyerId)
    .maybeSingle();

  if (fetchError) return { data: null, error: fetchError };
  if (existing) return { data: existing, error: null };

  const { data: created, error: createError } = await supabase
    .from('cart')
    .insert({ buyer_id: buyerId })
    .select()
    .single();

  return { data: created, error: createError };
}

async function getCartWithItems(buyerId) {
  const { data: cart, error: cartError } = await getOrCreateCart(buyerId);
  if (cartError) return { data: null, error: cartError };

  const { data: items, error: itemsError } = await supabase
    .from('cart_items')
    .select('id, quantity, listing:listings(id, title, price, stock, status, seller_id)')
    .eq('cart_id', cart.id)
    .order('id', { ascending: true });

  if (itemsError) return { data: null, error: itemsError };

  return { data: { cart, items }, error: null };
}

async function getListingForCart(listingId) {
  const { data, error } = await supabase.from('listings').select('*').eq('id', listingId).maybeSingle();
  return { data, error };
}

async function findCartItem(cartId, listingId) {
  const { data, error } = await supabase
    .from('cart_items')
    .select('*')
    .eq('cart_id', cartId)
    .eq('listing_id', listingId)
    .maybeSingle();
  return { data, error };
}

async function addCartItem(cartId, listingId, quantity) {
  const { data, error } = await supabase
    .from('cart_items')
    .insert({ cart_id: cartId, listing_id: listingId, quantity })
    .select()
    .single();
  return { data, error };
}

async function setCartItemQuantity(id, quantity) {
  const { data, error } = await supabase.from('cart_items').update({ quantity }).eq('id', id).select().single();
  return { data, error };
}

async function getCartItemWithCart(id) {
  const { data, error } = await supabase
    .from('cart_items')
    .select('*, cart(id, buyer_id)')
    .eq('id', id)
    .maybeSingle();
  return { data, error };
}

async function removeCartItem(id) {
  const { error } = await supabase.from('cart_items').delete().eq('id', id);
  return { error };
}

module.exports = {
  getOrCreateCart,
  getCartWithItems,
  getListingForCart,
  findCartItem,
  addCartItem,
  setCartItemQuantity,
  getCartItemWithCart,
  removeCartItem,
};
