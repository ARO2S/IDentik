/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    /**
     * Ensure heavy native-like deps stay as Node externals so their dynamic require()
     * logic can locate vendored binaries at runtime (Next dev was bundling them).
     */
    serverComponentsExternalPackages: ['exiftool-vendored', 'batch-cluster']
  },
  webpack: (config) => {
    const extensionAlias = config.resolve?.extensionAlias ?? {};

    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs']
    };

    return config;
  }
};

export default nextConfig;
