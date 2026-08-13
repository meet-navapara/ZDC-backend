import { z } from "zod";
import { TryonJob } from "../models/TryonJob.js";
import { Payment } from "../models/Payment.js";
import { getPaymentProvider } from "../services/payments.js";
import { startProcessing } from "./tryonController.js";
import { objectIdField } from "../utils/validators.js";

const paySchema = z.object({
  jobId: objectIdField,
  gateway: z.enum(["stub", "mpesa", "intasend"]).optional(),
});

export async function payForJob(req, res, next) {
  try {
    const data = paySchema.parse(req.body);

    const job = await TryonJob.findById(data.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.status !== "awaiting_payment") {
      return res
        .status(409)
        .json({ error: `Job is not awaiting payment (status: ${job.status})` });
    }

    const provider = getPaymentProvider();
    const charge = await provider.createCharge({
      amount: job.amount,
      currency: job.currency,
      reference: `job_${job._id}`,
    });

    const payment = await Payment.create({
      user: req.user?.sub || null,
      job: job._id,
      gateway: data.gateway || charge.gateway,
      amount: job.amount,
      currency: job.currency,
      purpose: "b2c_tryon",
      status: charge.status,
      reference: charge.reference,
    });

    if (charge.status !== "paid") {
      return res.status(402).json({ error: "Payment not completed", payment });
    }

    job.payment = payment._id;
    job.status = "processing";
    await job.save();

    startProcessing(job._id.toString());

    return res.json({
      payment: {
        id: payment._id.toString(),
        status: payment.status,
        reference: payment.reference,
        gateway: payment.gateway,
        amount: payment.amount,
        currency: payment.currency,
      },
      job: job.toJSONSafe(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.issues });
    }
    return next(err);
  }
}
