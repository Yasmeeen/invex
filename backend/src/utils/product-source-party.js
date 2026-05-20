import mongoose from 'mongoose';
import Client from '../DB/models/client.model.js';
import Vendor from '../DB/models/vendor.model.js';
import Category from '../DB/models/category.model.js';
import { buildPhoneSearchCandidates, digitsOnly } from './phone-utils.js';

function canonicalPhoneForStorage(raw) {
  const d = digitsOnly(raw);
  if (d.length >= 10) {
    const last10 = d.slice(-10);
    return `0${last10}`;
  }
  return String(raw || '').trim();
}

async function findClientByPhone(raw) {
  const candidates = buildPhoneSearchCandidates(raw);
  const last10 = digitsOnly(raw).slice(-10);
  let client = await Client.findOne({ phoneNumber: { $in: candidates } });
  if (!client && last10 && last10.length === 10) {
    client = await Client.findOne({
      phoneNumber: { $regex: new RegExp(`${last10}$`) },
    });
  }
  return client;
}

async function findVendorByPhone(raw) {
  const candidates = buildPhoneSearchCandidates(raw);
  const last10 = digitsOnly(raw).slice(-10);
  let vendor = await Vendor.findOne({ phone: { $in: candidates } });
  if (!vendor && last10 && last10.length === 10) {
    vendor = await Vendor.findOne({
      phone: { $regex: new RegExp(`${last10}$`) },
    });
  }
  return vendor;
}

function normalizePartyType(raw) {
  const t = String(raw || 'client').trim().toLowerCase();
  return t === 'supplier' ? 'supplier' : 'client';
}

function parseAcquiredFromInput(body) {
  const block = body?.acquiredFrom && typeof body.acquiredFrom === 'object' ? body.acquiredFrom : body;
  const partyType = normalizePartyType(block?.partyType ?? block?.sourcePartyType);
  const phone = String(block?.phone ?? block?.sourcePartyPhone ?? '').trim();
  const name = String(block?.name ?? block?.displayName ?? block?.sourcePartyName ?? '').trim();
  const address = String(block?.address ?? '').trim();
  const clientId = block?.clientId ? String(block.clientId).trim() : '';
  const vendorId = block?.vendorId ? String(block.vendorId).trim() : '';
  return { partyType, phone, name, address, clientId, vendorId };
}

function isAcquiredFromEmpty({ phone, name, clientId, vendorId }) {
  return !phone && !name && !clientId && !vendorId;
}

/**
 * Resolve optional "acquired from" party for a product (client or supplier).
 * Returns null when section is empty; otherwise { acquiredFrom: { ... } } for Product.create/update.
 */
export async function resolveProductAcquiredFrom(body, { categoryId, branchOid } = {}) {
  const input = parseAcquiredFromInput(body);
  if (isAcquiredFromEmpty(input)) {
    return null;
  }

  const { partyType, phone, name, address, clientId, vendorId } = input;

  if (partyType === 'supplier') {
    if (vendorId && mongoose.Types.ObjectId.isValid(vendorId)) {
      const vendor = await Vendor.findById(vendorId).lean();
      if (!vendor) {
        throw Object.assign(new Error('Supplier not found'), { code: 'SUPPLIER_NOT_FOUND' });
      }
      const displayName = String(vendor.nameOfcompany || vendor.name || '').trim() || name;
      return {
        acquiredFrom: {
          partyType: 'supplier',
          vendorId: vendor._id,
          clientId: null,
          displayName,
          phone: String(vendor.phone || phone || '').trim(),
        },
      };
    }

    if (phone) {
      let vendor = await findVendorByPhone(phone);
      if (!vendor) {
        if (!name) {
          throw Object.assign(new Error('Name is required to register a new supplier'), {
            code: 'SOURCE_PARTY_NAME_REQUIRED',
          });
        }
        const catOid =
          categoryId && mongoose.Types.ObjectId.isValid(String(categoryId))
            ? new mongoose.Types.ObjectId(String(categoryId))
            : (await Category.findOne().select('_id').lean())?._id;
        if (!catOid) {
          throw Object.assign(new Error('Cannot register supplier without a category'), {
            code: 'NO_CATEGORY_FOR_SUPPLIER',
          });
        }
        vendor = await Vendor.create({
          nameOfcompany: name,
          name,
          phone: canonicalPhoneForStorage(phone) || phone,
          address: address || '',
          paymentTerms: ['cash'],
          categories: [catOid],
        });
      }
      const displayName = String(vendor.nameOfcompany || vendor.name || name).trim();
      return {
        acquiredFrom: {
          partyType: 'supplier',
          vendorId: vendor._id,
          clientId: null,
          displayName,
          phone: String(vendor.phone || phone).trim(),
        },
      };
    }

    if (name) {
      return {
        acquiredFrom: {
          partyType: 'supplier',
          vendorId: null,
          clientId: null,
          displayName: name,
          phone: '',
        },
      };
    }

    return null;
  }

  // client
  if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
    const client = await Client.findById(clientId).lean();
    if (!client) {
      throw Object.assign(new Error('Client not found'), { code: 'CLIENT_NOT_FOUND' });
    }
    return {
      acquiredFrom: {
        partyType: 'client',
        clientId: client._id,
        vendorId: null,
        displayName: String(client.name || name).trim(),
        phone: String(client.phoneNumber || phone).trim(),
      },
    };
  }

  if (phone) {
    let client = await findClientByPhone(phone);
    if (!client) {
      if (!name) {
        throw Object.assign(new Error('Name is required to register a new client'), {
          code: 'SOURCE_PARTY_NAME_REQUIRED',
        });
      }
      const phoneNumber = canonicalPhoneForStorage(phone) || phone;
      client = await Client.create({
        name,
        phoneNumber,
        address: address || '-',
        branches:
          branchOid && mongoose.Types.ObjectId.isValid(String(branchOid))
            ? [new mongoose.Types.ObjectId(String(branchOid))]
            : [],
      });
    } else if (branchOid && mongoose.Types.ObjectId.isValid(String(branchOid))) {
      await Client.updateOne(
        { _id: client._id },
        { $addToSet: { branches: new mongoose.Types.ObjectId(String(branchOid)) } }
      );
    }
    return {
      acquiredFrom: {
        partyType: 'client',
        clientId: client._id,
        vendorId: null,
        displayName: String(client.name || name).trim(),
        phone: String(client.phoneNumber || phone).trim(),
      },
    };
  }

  if (name) {
    return {
      acquiredFrom: {
        partyType: 'client',
        clientId: null,
        vendorId: null,
        displayName: name,
        phone: '',
      },
    };
  }

  return null;
}

/** Clear acquiredFrom when client sends acquiredFrom: null or empty object. */
export function shouldClearAcquiredFrom(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'acquiredFrom')) {
    return false;
  }
  const raw = body.acquiredFrom;
  if (raw === null) return true;
  if (typeof raw !== 'object') return false;
  const input = parseAcquiredFromInput({ acquiredFrom: raw });
  return isAcquiredFromEmpty(input);
}
