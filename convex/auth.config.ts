// Convex verifies the Clerk JWT itself. CLERK_JWT_ISSUER_DOMAIN is set as a
// Convex environment variable (see README, step 3).
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
