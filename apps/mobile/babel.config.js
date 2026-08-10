module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    // react-native-reanimated's plugin must run last (its own docs' hard
    // requirement) — react-native-worklets/plugin is its Reanimated-4
    // successor per the current NativeWind/Reanimated compatibility docs.
    plugins: ["react-native-worklets/plugin"],
  };
};
