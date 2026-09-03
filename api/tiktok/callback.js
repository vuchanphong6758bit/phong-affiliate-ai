export default async function handler(req, res) {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).json({
      success: false,
      error,
      error_description,
    });
  }

  if (!code) {
    return res.status(400).json({
      success: false,
      message: "Missing authorization code",
    });
  }

  return res.status(200).json({
    success: true,
    message: "TikTok authorization callback received",
    code_received: true,
    state_received: Boolean(state),
  });
}
