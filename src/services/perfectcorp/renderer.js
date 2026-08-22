import { env } from "../../config/env.js";

import { uploadFromUrl, ensureMinImageSize } from "../storage.js";

import {

  runClothTryOn,

  runHairTransferTryOn,

  runHairColorTryOn,

  runBeardStyleTryOn,

  isPublicImageUrl,

} from "./client.js";

import {

  normalizePerfectCorpFeature,

  featureNeedsReferenceImage,
  parseMultiValueField,

} from "./features.js";



/**

 * Perfect Corp / YouCam AI renderer.

 * Docs: https://docs.makeupar.com/develop/introduction

 * Features: cloth, hair, haircolor, beard

 */

export class PerfectCorpRenderer {

  constructor() {

    this.name = "perfectcorp";

  }



  async render({

    sourceUrl,

    targetUrls,

    targetUrl,

    count,

    feature,

    hairColorPreset,

    beardTemplateId,

  }) {

    const targets =

      Array.isArray(targetUrls) && targetUrls.length

        ? targetUrls

        : targetUrl

          ? [targetUrl]

          : [];



    if (!isPublicImageUrl(sourceUrl)) {

      throw new Error(

        "YouCam requires publicly accessible HTTPS image URLs. Configure Cloudinary (CLOUDINARY_URL) so uploads are reachable by Perfect Corp."

      );

    }

    const readySourceUrl = await ensureMinImageSize(sourceUrl);



    const mode = normalizePerfectCorpFeature(

      feature || env.perfectcorp.defaultFeature

    );

    const needsRef = featureNeedsReferenceImage(mode);

    const n = needsRef

      ? targets.length || count || 1

      : Math.max(1, count || targets.length || 1);



    const results = [];

    const taskIds = [];



    for (let i = 0; i < n; i += 1) {

      const refUrl = needsRef ? targets[i] || targets[0] : null;

      let task;



      if (mode === "hair") {

        if (!refUrl) {

          throw new Error("Missing hairstyle reference image");

        }

        if (!isPublicImageUrl(refUrl)) {

          throw new Error(

            "Reference image must be a public HTTPS URL (configure Cloudinary for uploads)."

          );

        }

        task = await runHairTransferTryOn({
          sourceUrl: readySourceUrl,
          refUrl: await ensureMinImageSize(refUrl),
        });

      } else if (mode === "haircolor") {

        const presetList = parseMultiValueField(
          hairColorPreset || env.perfectcorp.hairColorPreset || "Honey Blonde",
          n,
          env.perfectcorp.hairColorPreset || "Honey Blonde"
        );
        const preset = presetList[i] || presetList[0];

        task = await runHairColorTryOn({ sourceUrl: readySourceUrl, preset });

      } else if (mode === "beard") {

        const templateList = parseMultiValueField(
          beardTemplateId || env.perfectcorp.beardTemplateId || "",
          n,
          env.perfectcorp.beardTemplateId || ""
        );
        const templateId = templateList[i] || templateList[0];

        task = await runBeardStyleTryOn({ sourceUrl: readySourceUrl, templateId });

      } else {

        if (!refUrl) {

          throw new Error("Missing outfit reference image");

        }

        if (!isPublicImageUrl(refUrl)) {

          throw new Error(

            "Reference image must be a public HTTPS URL (configure Cloudinary for uploads)."

          );

        }

        task = await runClothTryOn({
          sourceUrl: readySourceUrl,
          refUrl: await ensureMinImageSize(refUrl),
        });

      }



      taskIds.push(task.taskId);



      const stored = await uploadFromUrl(task.url, {

        folder: "zdc/tryon/results",

      });

      results.push(stored.url);

    }



    return { urls: results, taskIds };

  }

}



export function isPerfectCorpConfigured() {

  return Boolean(env.perfectcorp.enabled && env.perfectcorp.apiKey);

}


