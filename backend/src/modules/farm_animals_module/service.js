import mongoose from 'mongoose';
import FarmAnimal from '../../DB/models/farmAnimal.model.js';
import FarmAnimalCounter from '../../DB/models/farmAnimalCounter.model.js';

function serialFor(n) {
  return String(n);
}

function expandShares(rawQuantity) {
  const quarterUnits = Math.round((Number(rawQuantity) || 0) * 4);
  if (quarterUnits <= 0 || Math.abs((Number(rawQuantity) || 0) * 4 - quarterUnits) > 0.0001) {
    throw new Error('Farm animal quantity must be in quarter-head increments');
  }
  const shares = [];
  let left = quarterUnits;
  while (left > 0) {
    const take = Math.min(4, left);
    shares.push(take / 4);
    left -= take;
  }
  return shares;
}

async function reserveSerialRange(count) {
  const counter = await FarmAnimalCounter.findOneAndUpdate(
    { _id: 'farm-animal' },
    { $inc: { value: count } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  const end = Number(counter.value);
  return { start: end - count + 1, end };
}

export async function registerPurchasedFarmAnimals({
  product,
  purchaseRequest,
  quantity,
  animalWeightKg,
  costPerKg,
  unitNet,
  actorId,
  session,
}) {
  if (!product?._id) throw new Error('Farm animal product is required');
  const shares = expandShares(quantity);
  const range = await reserveSerialRange(shares.length);
  const weight = Math.max(0, Number(animalWeightKg) || 0);
  const costRate = Math.max(0, Number(costPerKg) || 0);
  const documents = shares.map((share, index) => {
    const serialNumber = range.start + index;
    return {
      serialNumber,
      serial: serialFor(serialNumber),
      product: product._id,
      purchaseRequest: purchaseRequest?._id || purchaseRequest || null,
      acquiredShare: share,
      remainingShare: share,
      status: 'available',
      branch: product.branch || null,
      inWarehouse: product.inWarehouse === true,
      factory: product.factory || null,
      purchaseWeightKg: weight,
      currentWeightKg: weight,
      costPerKg: costRate,
      acquisitionCost:
        Math.round(
          (costRate > 0 && weight > 0 ? costRate * weight * share : (Number(unitNet) || 0) * share) *
            100
        ) / 100,
      createdBy: actorId || null,
    };
  });
  return FarmAnimal.insertMany(documents, { session, ordered: true });
}

function locationFilter(query) {
  const filter = {};
  if (query.branchId && mongoose.Types.ObjectId.isValid(String(query.branchId))) {
    filter.branch = new mongoose.Types.ObjectId(String(query.branchId));
    filter.inWarehouse = false;
  } else if (String(query.inWarehouse) === 'true') {
    filter.inWarehouse = true;
  }
  if (query.factoryId && mongoose.Types.ObjectId.isValid(String(query.factoryId))) {
    filter.factory = new mongoose.Types.ObjectId(String(query.factoryId));
  }
  return filter;
}

export async function listFarmAnimals(req, res) {
  try {
    const filter = { ...locationFilter(req.query) };
    if (req.query.productId && mongoose.Types.ObjectId.isValid(String(req.query.productId))) {
      filter.product = new mongoose.Types.ObjectId(String(req.query.productId));
    }
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.available === 'true') {
      filter.status = 'available';
      filter.remainingShare = { $gt: 0 };
    }
    const search = String(req.query.search || '').trim();
    if (search) filter.serial = { $regex: search, $options: 'i' };
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const animals = await FarmAnimal.find(filter)
      .populate('product', 'name code price productType category branch inWarehouse factory')
      .populate('branch', 'name')
      .populate('factory', 'name')
      .sort({ serialNumber: 1 })
      .limit(limit)
      .lean();
    return res.json({ animals });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function lookupFarmAnimal(req, res) {
  try {
    const serial = String(req.params.serial || '').trim().toUpperCase();
    const animal = await FarmAnimal.findOne({ serial })
      .populate('product', 'name code price netPrice stock productType category branch inWarehouse factory')
      .populate('branch', 'name')
      .populate('factory', 'name')
      .lean();
    if (!animal) return res.status(404).json({ error: 'Farm animal not found' });
    return res.json({ animal });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function updateFarmAnimal(req, res) {
  try {
    const id = String(req.params.id || '');
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid farm animal id' });
    }
    const update = {};
    if (req.body.currentWeightKg != null) {
      const weight = Number(req.body.currentWeightKg);
      if (!Number.isFinite(weight) || weight <= 0) {
        return res.status(400).json({ error: 'Valid current weight is required' });
      }
      update.currentWeightKg = Math.round(weight * 1000) / 1000;
    }
    if (req.body.notes != null) update.notes = String(req.body.notes || '').trim();
    const animal = await FarmAnimal.findByIdAndUpdate(id, { $set: update }, { new: true })
      .populate('product', 'name code price productType')
      .lean();
    if (!animal) return res.status(404).json({ error: 'Farm animal not found' });
    return res.json({ animal });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
