module.exports = function (api) {
  api.cache(true);

  const presets = [
    [
      '@babel/preset-env',
      {
        corejs: '3',
        include: [
          'transform-object-rest-spread',
          'transform-optional-chaining',
        ],
        useBuiltIns: 'entry',
        targets: {
          esmodules: true,
        },
      },
    ],
    '@babel/preset-react',
    '@babel/typescript',
  ];
  const plugins = [
    // Muya source uses legacy decorators heavily.
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    // Keep class fields compatible with legacy decorators semantics.
    ['@babel/plugin-transform-class-properties', { loose: true }],
    // Keep "loose" setting consistent across class fields + private features to avoid
    // massive warning spam when compiling Muya source.
    ['@babel/plugin-transform-private-methods', { loose: true }],
    ['@babel/plugin-transform-private-property-in-object', { loose: true }],
    '@babel/plugin-syntax-dynamic-import',
    '@babel/plugin-transform-runtime',
  ];
  const env = {
    development: {
      compact: false,
    },
    test: {
      plugins: ['dynamic-import-node'],
    },
  };

  return {
    presets,
    plugins,
    env,
  };
};
