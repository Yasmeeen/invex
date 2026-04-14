import { getProfitReport, getSalesReport } from '../reports_module/service.js';
import { getBookingsReport } from '../product_bookings_module/service.js';

function makeResCapture() {
  const out = {
    statusCode: 200,
    jsonBody: null,
  };
  const res = {
    status(code) {
      out.statusCode = code;
      return res;
    },
    json(body) {
      out.jsonBody = body;
      return res;
    },
  };
  return { res, out };
}

async function runHandler(handler, { query = {}, body = {} }) {
  const req = { query, body };
  const { res, out } = makeResCapture();
  await handler(req, res);
  return out;
}

export async function toolSales({ from, to, branch_id, groupBy }) {
  return runHandler(getSalesReport, {
    query: { from, to, branch_id, groupBy },
  });
}

export async function toolProfit({ from, to, branch_id, groupBy }) {
  return runHandler(getProfitReport, {
    query: { from, to, branch_id, groupBy },
  });
}

export async function toolBookings({ from, to, branch_id, groupBy, page, limit }) {
  return runHandler(getBookingsReport, {
    query: { from, to, branch_id, groupBy, page, limit },
  });
}

