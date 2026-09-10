const crypto = require('crypto');
const path = require('path');
const supabase = require('../lib/db');

const BUCKET = 'listing-images';

async function getNextSortOrder(listingId) {
  const { count } = await supabase
    .from('listing_images')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', listingId);
  return count ?? 0;
}

async function uploadImages(listingId, files) {
  let nextSortOrder = await getNextSortOrder(listingId);
  const rows = [];

  for (const file of files) {
    const ext = path.extname(file.originalname) || '';
    const storagePath = `${listingId}/${crypto.randomUUID()}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      return { data: null, error: uploadError };
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    rows.push({
      listing_id: listingId,
      image_url: publicUrlData.publicUrl,
      sort_order: nextSortOrder,
    });
    nextSortOrder += 1;
  }

  const { data, error } = await supabase.from('listing_images').insert(rows).select();
  return { data, error };
}

// Derives the storage object path from a public URL produced by
// getPublicUrl() above (".../object/public/listing-images/<path>") rather
// than storing the path as its own column -- the URL already encodes it
// deterministically, and every row's URL was generated this same way.
function storagePathFromUrl(imageUrl) {
  const marker = `/${BUCKET}/`;
  const index = imageUrl.indexOf(marker);
  return index === -1 ? null : imageUrl.slice(index + marker.length);
}

async function deleteImage(listingId, imageId) {
  const { data: image, error: fetchError } = await supabase
    .from('listing_images')
    .select('*')
    .eq('id', imageId)
    .eq('listing_id', listingId)
    .maybeSingle();
  if (fetchError) return { error: fetchError, notFound: false };
  if (!image) return { error: null, notFound: true };

  const storagePath = storagePathFromUrl(image.image_url);
  if (storagePath) {
    // Best-effort: the row is the source of truth for what the API/UI
    // shows, so a storage-removal failure (e.g. object already gone)
    // shouldn't block deleting the row itself.
    await supabase.storage.from(BUCKET).remove([storagePath]);
  }

  const { error } = await supabase.from('listing_images').delete().eq('id', imageId);
  return { error, notFound: false };
}

module.exports = { uploadImages, deleteImage };
