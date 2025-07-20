import Order from '../../DB/models/order.model.js';

export const getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;
    const searchRegex = new RegExp(search, 'i'); // case-insensitive

    const query = { client_name: { $regex: searchRegex } };

    const orders = await Order.find(query)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.json({
      orders,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('❌ Error fetching orders:', err.message);
    res.status(500).json({ error: 'Server error' });
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
  try {
    const { client_name, total_amount, status } = req.body;

    if (!client_name || !total_amount || !status) {
      return res.status(400).json({ error: 'client_name, total_amount, and status are required' });
    }

    const newOrder = await Order.create({ client_name, total_amount, status });

    res.status(201).json({ message: '✅ Order created', order: newOrder });
  } catch (err) {
    console.error('❌ Error creating order:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateOrder = async (req, res) => {
  try {
    const { client_name, total_amount, status } = req.body;

    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { client_name, total_amount, status },
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ message: '✅ Order updated', order: updatedOrder });
  } catch (err) {
    console.error('❌ Error updating order:', err.message);
    res.status(500).json({ error: 'Server error' });
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
