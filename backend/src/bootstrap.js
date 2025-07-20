import cors from 'cors';
import categoriesRoutes from './modules/categories_module/router.js';
import branchesRoutes from './modules/branches_module/router.js';
import ordersRoutes from './modules/orders_module/router.js';
import productRoutes from './modules/products_module/router.js'; 
import connectToMongoDB from './DB/connection.js';

const PORT = 3000;

const bootstrap = (app, express) => {
  // Middleware
  app.use(express.json());
  app.use(cors({
    credentials: true,
    origin: ['http://localhost:4400']
  }));

  // Connect to MongoDB
   connectToMongoDB();

  // Routes
  app.use('/api/products', productRoutes);
  app.use('/api/categories', categoriesRoutes);
  app.use('/api/branches', branchesRoutes);
  app.use('/api/orders', ordersRoutes);

  // Start server
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });

};


export default bootstrap;
