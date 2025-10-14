import Order from '../../DB/models/order.model.js';
import Product from '../../DB/models/product.model.js';
import Branch from '../../DB/models/branch.model.js';
import mongoose from 'mongoose';

export const getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', searchBranch = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = {};

    // ✅ 1. Search by order number, client name, or phone number
    if (search) {
      const isNumber = !isNaN(search);
      query.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { clientPhoneNumber: { $regex: search, $options: 'i' } },
      ];

      if (isNumber) {
        query.$or.push({ orderNumber: Number(search) });
      }
    }

    // ✅ 2. Search by branch name (works independently)
    if (searchBranch) {
      const branch = await Branch.findOne({
        name: { $regex: searchBranch, $options: 'i' },
      });

      if (branch) {
        query.branch = branch._id;
      } else {
        // No branch found → return empty
        return res.json({
          orders: [],
          meta: {
            currentPage: Number(page),
            totalCount: 0,
            totalPages: 0,
          },
        });
      }
    }

    // ✅ 3. Fetch orders
    const [orders, total] = await Promise.all([
      Order.find(query)
        .select(
          'orderNumber clientName clientPhoneNumber totalPrice numberOfProducts status paymentMethod createdAt branch'
        )
        .populate('branch', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),

      Order.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    // ✅ 4. Respond
    res.json({
      orders,
      meta: {
        currentPage: Number(page),
        nextPage: page < totalPages ? Number(page) + 1 : null,
        prevPage: page > 1 ? Number(page) - 1 : null,
        totalCount: total,
        totalPages,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};





export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (err) {
    console.error('❌ Error fetching order:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      clientName,
      clientPhoneNumber,
      sellerName,
      clientAddress,
      paymentMethod,
      branch,
      products,
      status,
    } = req.body;

    if (!clientName || !clientPhoneNumber || !paymentMethod || !clientAddress ) {
      return res.status(400).json({
        error:
          'clientName, clientPhoneNumber, paymentMethod, sellerName, and clientAddress are required',
      });
    }

    if (!products || products.length === 0) {
      return res
        .status(400)
        .json({ error: 'Order must contain at least one product' });
    }

    let totalPrice = 0;
    let numberOfProducts = 0;
    const productIds = [];

    // ✅ Calculate totals & update stock
    for (const item of products) {
      const selected = item.selectedProduct;
      if (!selected || !selected._id) continue;

      const quantity = Number(item.quantity) || 1;
      numberOfProducts += quantity;

      let price = Number(selected.price) || 0;
      if (selected.isApplyDiscount && selected.discount > 0) {
        price -= price * (selected.discount / 100);
      }

      totalPrice += price * quantity;
      productIds.push(selected._id);

      const productDoc = await Product.findById(selected._id).session(session);
      if (!productDoc) throw new Error(`Product not found: ${selected._id}`);

      if (productDoc.stock < quantity) {
        throw new Error(`Not enough stock for ${productDoc.name}`);
      }

      productDoc.stock -= quantity;
      await productDoc.save({ session });
    }

    // ✅ Generate next order number
    const lastOrder = await Order.findOne().sort({ orderNumber: -1 }).lean();
    const nextOrderNumber = Number(lastOrder?.orderNumber || 0) + 1;

    // ✅ Create order
    const newOrder = await Order.create(
      [
        {
          orderNumber: nextOrderNumber,
          clientName,
          clientPhoneNumber,
          sellerName,
          paymentMethod,
          clientAddress,
          branch,
          products: productIds,
          numberOfProducts,
          totalPrice,
          status,
        },
      ],
      { session }
    );


    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ message: '✅ Order created',newOrder});
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('❌ Error creating order:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};





export const updateOrder = async (req, res) => {
  try {
    const {
      clientName,
      clientPhoneNumber,
      sellerName,
      clientAddress,
      branch,
      products,
      status,
    } = req.body;

    if (!clientName || !clientPhoneNumber || !sellerName || !clientAddress) {
      return res.status(400).json({
        error: 'clientName, clientPhoneNumber, sellerName, and clientAddress are required',
      });
    }

    if (!products || products.length === 0) {
      return res.status(400).json({ error: 'Order must contain at least one product' });
    }

    // Fetch products from DB to calculate total
    const dbProducts = await Product.find({ _id: { $in: products } });

    if (dbProducts.length !== products.length) {
      return res.status(400).json({ error: 'Some products not found' });
    }

    const totalPrice = dbProducts.reduce((sum, p) => sum + p.price, 0);
    const numberOfProducts = dbProducts.length;

    const newOrder = await Order.create({
      clientName,
      clientPhoneNumber,
      sellerName,
      clientAddress,
      branch,
      products,
      numberOfProducts,
      totalPrice,
      status, // defaults to "pending" if not provided
    });

    res.status(201).json({ message: '✅ Order created', order: newOrder });
  } catch (err) {
    console.error('❌ Error creating order:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};


export const restoreOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    // ✅ populate products (since your field is called 'products')
    const order = await Order.findById(orderId).populate('products');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'restored') {
      return res.status(400).json({ error: 'Order is already restored' });
    }

    // ✅ Restore product stock
    for (const item of order.products) {
      const product = await Product.findById(item.product); // item.product is ObjectId
      if (product) {
        product.stock += item.quantity; // 👈 add back the quantity
        await product.save();
      }
    }

    // ✅ Update order status
    order.status = 'restored';
    await order.save();

    res.json({
      message: 'Order restored successfully',
      restoredOrder: order,
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error restoring order' });
  }
};






export const deleteOrder = async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);

    if (!deletedOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ message: '✅ Order deleted' });
  } catch (err) {
    console.error('❌ Error deleting order:', err.message);
    res.status(500).json({ error: 'Server error' });
  }

  
};
