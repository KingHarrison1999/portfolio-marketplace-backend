const express = require('express');
const cors = require('cors');

const corsOptions = require('./config/cors');
const healthRoute = require('./routes/health');
const profileRoute = require('./routes/profile');
const testRoute = require('./routes/test');
const listingsRoute = require('./routes/listings');
const cartRoute = require('./routes/cart');
const checkoutRoute = require('./routes/checkout');
const addressesRoute = require('./routes/addresses');
const ordersRoute = require('./routes/orders');
const categoriesRoute = require('./routes/categories');
const adSpacesRoute = require('./routes/adSpaces');
const adminRoute = require('./routes/admin');
const notificationPreferencesRoute = require('./routes/notificationPreferences');
const newsletterRoute = require('./routes/newsletter');
const contactRoute = require('./routes/contact');

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

app.use('/api', healthRoute);
app.use('/api/profile', profileRoute);
app.use('/api/test', testRoute);
app.use('/api/listings', listingsRoute);
app.use('/api/cart', cartRoute);
app.use('/api/checkout', checkoutRoute);
app.use('/api/addresses', addressesRoute);
app.use('/api/orders', ordersRoute);
app.use('/api/categories', categoriesRoute);
app.use('/api/ad-spaces', adSpacesRoute);
app.use('/api/admin', adminRoute);
app.use('/api/notification-preferences', notificationPreferencesRoute);
app.use('/api/newsletter', newsletterRoute);
app.use('/api/contact', contactRoute);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
