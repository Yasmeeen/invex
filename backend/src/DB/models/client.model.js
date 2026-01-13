import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    address: { type: String, trim: true },

    // Client may belong to one or more branches
    branchs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Branch",
      },
    ],
  },
  {
    timestamps: true, // creates createdAt & updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/**
 * Virtual fields (NOT stored in DB)
 * These match frontend model exactly
 */
clientSchema.virtual("numberOfOrders").get(function () {
  return this._doc.numberOfOrders || 0;
});

clientSchema.virtual("totalOrdersPrice").get(function () {
  return this._doc.totalOrdersPrice || 0;
});

const Client = mongoose.model("Client", clientSchema);
export default Client;
