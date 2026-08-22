import mongoose from "mongoose";

const { Schema } = mongoose;

// Actions we record. Keep as a flat, greppable list so the UI can filter.
export const AUDIT_ACTIONS = [
  "user.status_changed",
  "user.password_reset",
  "user.deleted",
  "pricing.updated",
  "content.updated",
  "payment.refunded",
];

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorEmail: { type: String, default: null },
    action: { type: String, required: true, index: true },
    targetType: { type: String, default: null }, // "user" | "pricing" | ...
    targetId: { type: Schema.Types.ObjectId, default: null },
    targetLabel: { type: String, default: null }, // email / business name / etc.
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });

auditLogSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id.toString(),
    actor: this.actor ? this.actor.toString() : null,
    actorEmail: this.actorEmail,
    action: this.action,
    targetType: this.targetType,
    targetId: this.targetId ? this.targetId.toString() : null,
    targetLabel: this.targetLabel,
    meta: this.meta || {},
    createdAt: this.createdAt,
  };
};

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
