const supabase = require('../lib/db');

async function subscribe(email) {
  const { data, error } = await supabase
    .from('newsletter_subscribers')
    .insert({ email })
    .select()
    .single();
  return { data, error };
}

module.exports = { subscribe };
