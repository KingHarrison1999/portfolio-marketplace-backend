const supabase = require('../lib/db');

const UPDATABLE_FIELDS = ['title', 'description', 'price', 'condition', 'stock', 'category_id', 'status'];

async function createListing(sellerId, fields) {
  const { title, description, price, condition, stock, category_id: categoryId } = fields;

  const { data, error } = await supabase
    .from('listings')
    .insert({
      seller_id: sellerId,
      title,
      description,
      price,
      condition,
      stock,
      category_id: categoryId,
    })
    .select()
    .single();

  return { data, error };
}

function attachImages(listing) {
  if (!listing) return listing;
  const images = (listing.listing_images || [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => ({ id: img.id, url: img.image_url, sort_order: img.sort_order }));
  listing.images = images;
  delete listing.listing_images;
  return listing;
}

async function getListingById(id) {
  const { data, error } = await supabase
    .from('listings')
    .select('*, listing_images(id, image_url, sort_order), profiles(display_name)')
    .eq('id', id)
    .order('sort_order', { foreignTable: 'listing_images' })
    .maybeSingle();

  if (data) {
    data.seller_display_name = data.profiles?.display_name ?? null;
    delete data.profiles;
  }

  return { data: attachImages(data), error };
}

async function getListingsBySeller(sellerId) {
  const { data, error } = await supabase
    .from('listings')
    .select('*, listing_images(image_url, sort_order)')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .order('sort_order', { foreignTable: 'listing_images', ascending: true })
    .limit(1, { foreignTable: 'listing_images' });

  if (data) {
    for (const listing of data) {
      listing.primary_image_url = listing.listing_images?.[0]?.image_url ?? null;
      delete listing.listing_images;
    }
  }
  return { data, error };
}

async function updateListing(id, fields) {
  const updates = { updated_at: new Date().toISOString() };
  for (const field of UPDATABLE_FIELDS) {
    if (fields[field] !== undefined) {
      updates[field] = fields[field];
    }
  }

  const { data, error } = await supabase.from('listings').update(updates).eq('id', id).select().single();
  return { data, error };
}

async function softDeleteListing(id) {
  const { data, error } = await supabase
    .from('listings')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

// PostgREST's .or() takes a raw filter string, where "," and "()" are
// syntax characters -- strip them from user search input before it's
// interpolated in, so a search term can't inject extra filter clauses.
function sanitizeSearchTerm(term) {
  return term.replace(/[,()]/g, ' ').trim();
}

// Escape ILIKE's own wildcard characters so a search term containing "%"
// or "_" is matched literally rather than as a pattern.
function toIlikePattern(term) {
  const escaped = term.replace(/[%_\\]/g, '\\$&');
  return `%${escaped}%`;
}

async function searchListings({ categoryIds, minPrice, maxPrice, q, sort, page, limit }) {
  let query = supabase
    .from('listings')
    .select('*, listing_images(image_url, sort_order)', { count: 'exact' })
    .eq('status', 'active');

  if (categoryIds && categoryIds.length > 0) {
    query = query.in('category_id', categoryIds);
  }
  if (minPrice !== undefined) {
    query = query.gte('price', minPrice);
  }
  if (maxPrice !== undefined) {
    query = query.lte('price', maxPrice);
  }
  if (q) {
    const term = sanitizeSearchTerm(q);
    if (term) {
      const pattern = toIlikePattern(term);
      query = query.or(`title.ilike.${pattern},description.ilike.${pattern}`);
    }
  }

  if (sort === 'price_asc') {
    query = query.order('price', { ascending: true });
  } else if (sort === 'price_desc') {
    query = query.order('price', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;
  query = query
    .range(from, to)
    .order('sort_order', { foreignTable: 'listing_images', ascending: true })
    .limit(1, { foreignTable: 'listing_images' });

  const { data, error, count } = await query;
  if (data) {
    for (const listing of data) {
      listing.primary_image_url = listing.listing_images?.[0]?.image_url ?? null;
      delete listing.listing_images;
    }
  }
  return { data, error, count };
}

async function getSellerDashboard(sellerId) {
  const [activeCountRes, soldCountRes, stockRes, recentOrderItemsRes] = await Promise.all([
    supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('status', 'active'),
    supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('status', 'sold'),
    supabase.from('listings').select('stock').eq('seller_id', sellerId).eq('status', 'active'),
    supabase
      .from('order_items')
      .select('id, listing_id, quantity, price_at_purchase, title_at_purchase, commission_amount, orders(id, status, created_at)')
      .eq('seller_id', sellerId)
      .order('created_at', { foreignTable: 'orders', ascending: false })
      .limit(10),
  ]);

  const firstError = [activeCountRes, soldCountRes, stockRes, recentOrderItemsRes].find((r) => r.error)?.error;
  if (firstError) {
    return { data: null, error: firstError };
  }

  const totalStock = stockRes.data.reduce((sum, row) => sum + row.stock, 0);

  return {
    data: {
      total_active_listings: activeCountRes.count,
      total_sold: soldCountRes.count,
      total_stock: totalStock,
      recent_order_items: recentOrderItemsRes.data,
    },
    error: null,
  };
}

// Admin "Manage Listings" -- unlike searchListings(), this is every
// listing regardless of status (draft/active/sold/removed) and seller, with
// the seller's display_name joined in for the page's "Seller" column.
async function getAllListingsForAdmin() {
  const { data, error } = await supabase
    .from('listings')
    .select('*, listing_images(image_url, sort_order), profiles(display_name)')
    .order('created_at', { ascending: false })
    .order('sort_order', { foreignTable: 'listing_images', ascending: true })
    .limit(1, { foreignTable: 'listing_images' });

  if (data) {
    for (const listing of data) {
      listing.primary_image_url = listing.listing_images?.[0]?.image_url ?? null;
      listing.seller_display_name = listing.profiles?.display_name ?? null;
      delete listing.listing_images;
      delete listing.profiles;
    }
  }
  return { data, error };
}

module.exports = {
  createListing,
  getListingById,
  getListingsBySeller,
  updateListing,
  softDeleteListing,
  getSellerDashboard,
  searchListings,
  getAllListingsForAdmin,
};
