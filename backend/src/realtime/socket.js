let ioRef = null;

export function setSocketServer(io) {
  ioRef = io;
}

export function getSocketServer() {
  return ioRef;
}

/** Emit an event to a list of userIds via user rooms. */
export function emitToUsers(userIds, event, payload) {
  const io = ioRef;
  if (!io) return;
  (userIds || []).forEach((id) => {
    if (!id) return;
    io.to(`user:${String(id)}`).emit(event, payload);
  });
}

