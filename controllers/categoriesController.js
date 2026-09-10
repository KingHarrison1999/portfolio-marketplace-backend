const categoriesService = require('../services/categoriesService');

async function assertCategoryExists(req, res) {
  const { data: category, error } = await categoriesService.getCategoryById(req.params.id);
  if (error) {
    res.status(500).json({ error: 'Failed to load category' });
    return null;
  }
  if (!category) {
    res.status(404).json({ error: 'Category not found' });
    return null;
  }
  return category;
}

async function list(req, res) {
  const { data, error } = await categoriesService.getAllCategories();
  if (error) {
    return res.status(500).json({ error: 'Failed to load categories' });
  }
  res.json({ categories: data });
}

async function create(req, res) {
  const { name, slug } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'name and slug are required' });
  }

  const { data, error } = await categoriesService.createCategory(req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json({ category: data });
}

async function update(req, res) {
  const category = await assertCategoryExists(req, res);
  if (!category) return;

  const { data, error } = await categoriesService.updateCategory(category.id, req.body);
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  res.json({ category: data });
}

async function remove(req, res) {
  const category = await assertCategoryExists(req, res);
  if (!category) return;

  const { count, error: countError } = await categoriesService.countActiveListings(category.id);
  if (countError) {
    return res.status(500).json({ error: 'Failed to check category usage' });
  }
  if (count > 0) {
    return res.status(409).json({
      error: `Cannot delete category: ${count} active listing(s) still reference it`,
    });
  }

  const { error } = await categoriesService.deleteCategory(category.id);
  if (error) {
    return res.status(500).json({ error: 'Failed to delete category' });
  }
  res.status(204).send();
}

module.exports = { list, create, update, remove };
