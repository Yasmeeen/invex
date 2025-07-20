import mongoose from 'mongoose';

const connectToMongoDB = async () => {
  mongoose.connect('mongodb://127.0.0.1:27017/ecommerce_app')
    .then(() => console.log('✅ Connected to MongoDB successfully.'))
    .catch(err => console.error('❌ MongoDB connection error:', err));
};

export default connectToMongoDB; // ✅ use ES module export
