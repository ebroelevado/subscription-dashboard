/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: [],
  experimental: {
    cpus: 4,
    workerThreads: false,
  }
};

export default nextConfig;
