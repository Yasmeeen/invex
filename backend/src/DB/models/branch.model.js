import mongoose from 'mongoose';

const branchSchema = new mongoose.Schema({
  name: { type: String, required: true },
  storeAddress: { type: String, required: true },
  rent: { type: Number, default: 0 },
  employeesSalary: { type: Number, default: 0 },
  branchInvoices: {type: Number, default: 0 },
  expenses: {type: Number, default: 0 },
  openingDate: { type: Date, default: null },
  salespeople: [
    {
      name: { type: String, required: true, trim: true },
      active: { type: Boolean, default: true },
    },
  ],
  deliveryStaff: [
    {
      name: { type: String, required: true, trim: true },
      active: { type: Boolean, default: true },
    },
  ],
}, { timestamps: true });



const Branch = mongoose.model('Branch', branchSchema);
export default Branch;

