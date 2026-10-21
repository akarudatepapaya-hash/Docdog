/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdfjs-dist'],
  // make sure pdfjs' files are shipped with the serverless functions that parse PDFs
  outputFileTracingIncludes: { '/api/acfta/documents': ['./node_modules/pdfjs-dist/legacy/build/**'] },
};
export default nextConfig;
