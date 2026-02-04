import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    address: {
      type: String,
      trim: true,
    },

    branches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals (filled via aggregation)
clientSchema.virtual("numberOfOrders").get(function () {
  return this._doc.numberOfOrders || 0;
});

clientSchema.virtual("totalOrdersPrice").get(function () {
  return this._doc.totalOrdersPrice || 0;
});

export default mongoose.model("Client", clientSchema);
