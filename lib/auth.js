function requireAdmin(req, res) {
  const configured = process.env.APP_ADMIN_SECRET;
  if (!configured) throw new Error('APP_ADMIN_SECRET is not configured');
  const supplied = req.headers['x-admin-secret'];
  if (!supplied || supplied !== configured) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
module.exports = { requireAdmin };
