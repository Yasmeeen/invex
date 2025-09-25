import mongoose from 'mongoose';

const connectToMongoDB = async () => {
  mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
    .then(() => console.log('✅ Connected to MongoDB Atlas successfully.'))
    .catch(err => console.error('❌ MongoDB connection error:', err));
};

export default connectToMongoDB;
