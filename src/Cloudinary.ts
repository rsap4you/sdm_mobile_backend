import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Product images
export const productImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "sdm-mobile/products",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        width: 1000,
        height: 1000,
        crop: "limit",
      },
    ],
  } as any,
});

// Profile images
export const profileImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "sdm-mobile/profiles",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        width: 400,
        height: 400,
        crop: "fill",
        gravity: "face",
      },
    ],
  } as any,
});

export default cloudinary;