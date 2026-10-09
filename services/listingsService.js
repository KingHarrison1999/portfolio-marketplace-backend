const supabase = require('../lib/db');

const UPDATABLE_FIELDS = ['title', 'description', 'price', 'condition', 'stock', 'category_id', 'status', 'seasons'];

// listings.seasons holds zero or more of these, in this order (a CHECK
// constraint enforces the same set at the DB level).
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

async function createListing(sellerId, fields) {
  const { title, description, price, condition, stock, category_id: categoryId, seasons } = fields;

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
      seasons,
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

// "New Arrivals" is a fixed-size curated shelf -- the newest active
// listings across every category -- not a real category or a paginated
// browse. See searchListings() below.
const NEW_ARRIVALS_COUNT = 16;

async function searchListings({ categoryIds, seasons, minPrice, maxPrice, q, sort, page, limit, collection }) {
  // Ignores category/price/search/sort/pagination inputs entirely -- it's
  // always "the newest N active listings, full stop", not something you
  // browse deeper into.
  if (collection === 'new-arrivals') {
    const { data, error } = await supabase
      .from('listings')
      .select('*, listing_images(image_url, sort_order)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .order('sort_order', { foreignTable: 'listing_images', ascending: true })
      .limit(1, { foreignTable: 'listing_images' })
      .range(0, NEW_ARRIVALS_COUNT - 1);

    if (data) {
      for (const listing of data) {
        listing.primary_image_url = listing.listing_images?.[0]?.image_url ?? null;
        delete listing.listing_images;
      }
    }
    return { data, error, count: data ? data.length : 0 };
  }

  let query = supabase
    .from('listings')
    .select('*, listing_images(image_url, sort_order)', { count: 'exact' })
    .eq('status', 'active');

  // "Secondhand" is a computed filter (condition isn't "new"), layered on
  // top of the normal filters rather than replacing them -- it can still
  // be combined with category/price/search/sort/pagination.
  if (collection === 'secondhand') {
    query = query.neq('condition', 'new');
  }

  if (categoryIds && categoryIds.length > 0) {
    query = query.in('category_id', categoryIds);
  }
  // Any of the requested seasons (array overlap).
  if (seasons && seasons.length > 0) {
    query = query.overlaps('seasons', seasons);
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

// Order statuses that count as a sale for "Popular This Week" (money taken;
// not pending, failed, cancelled or refunded).
const SOLD_ORDER_STATUSES = ['paid', 'processing', 'shipped', 'completed'];
const POPULAR_WINDOW_DAYS = 7;

// ISO-8601 week as { year, week } (weeks start Monday; week 1 holds the
// year's first Thursday).
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

// Small seeded PRNG (mulberry32): the same seed gives the same sequence.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// "Popular This Week": active listings ranked by units sold in the last 7
// days. If fewer than `count` have sales, the rest are other active
// listings in an order seeded by the ISO week, so the fill stays put for a
// week and changes the next. Each row carries units_sold_7d.
async function getPopularThisWeek(count = 8, now = new Date()) {
  const since = new Date(now.getTime() - POPULAR_WINDOW_DAYS * 86400000).toISOString();

  const [salesRes, listingsRes] = await Promise.all([
    supabase
      .from('order_items')
      .select('listing_id, quantity, orders!inner(status, created_at)')
      .not('listing_id', 'is', null)
      .in('orders.status', SOLD_ORDER_STATUSES)
      .gte('orders.created_at', since),
    supabase
      .from('listings')
      .select('*, listing_images(image_url, sort_order)')
      .eq('status', 'active')
      .order('sort_order', { foreignTable: 'listing_images', ascending: true })
      .limit(1, { foreignTable: 'listing_images' }),
  ]);

  const error = salesRes.error || listingsRes.error;
  if (error) return { data: null, error };

  const unitsById = new Map();
  for (const row of salesRes.data) {
    unitsById.set(row.listing_id, (unitsById.get(row.listing_id) || 0) + row.quantity);
  }

  const listings = listingsRes.data.map((listing) => {
    listing.primary_image_url = listing.listing_images?.[0]?.image_url ?? null;
    delete listing.listing_images;
    listing.units_sold_7d = unitsById.get(listing.id) || 0;
    return listing;
  });

  const ranked = listings
    .filter((listing) => listing.units_sold_7d > 0)
    .sort((a, b) => b.units_sold_7d - a.units_sold_7d || b.created_at.localeCompare(a.created_at))
    .slice(0, count);

  // Sorted by id first so the shuffle's input doesn't depend on DB row order.
  const rest = listings.filter((listing) => listing.units_sold_7d === 0).sort((a, b) => a.id.localeCompare(b.id));
  const { year, week } = isoWeek(now);
  const random = seededRandom(year * 100 + week);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  return { data: ranked.concat(rest.slice(0, count - ranked.length)), error: null };
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
  getPopularThisWeek,
  getAllListingsForAdmin,
  isoWeek,
  SEASONS,
};
