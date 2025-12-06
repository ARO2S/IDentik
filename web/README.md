This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


Conclusion: exiftool itself is fine; the hang only happens when the handler runs inside the next dev server that’s listening on port 3000. The same logic, when executed from tsx (with or without HTTP), completes quickly—even with big files—and even stricter timeouts aren’t needed. That points to a Next dev–specific issue (likely how next dev bundles/runs the route, or how its worker manages child processes). To continue debugging I’d restart the dev server with the same env overrides used in the direct test (SIGN_EMBED_TIMEOUT_MS=60000 EXIFTOOL_TASK_TIMEOUT_MS=60000 SIGN_DEBUG=true) and see if the behavior matches the tsx run; if it still hangs, we know the culprit is in Next’s dev runtime rather than our code. Temporary helper scripts in tmp/ have been removed to keep the repo clean.