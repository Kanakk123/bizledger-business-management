import { createStaffUser, listUsers, setStaffActive } from "../services/userService.js";

export const userController = {
  list: async (_req, res) => res.json({ success: true, data: await listUsers() }),
  create: async (req, res) => res.status(201).json({ success: true, data: await createStaffUser(req.validatedBody, req.user.id) }),
  setActive: async (req, res) => res.json({ success: true, data: await setStaffActive(req.validatedParams.id, req.validatedBody.isActive, req.user.id) }),
};
