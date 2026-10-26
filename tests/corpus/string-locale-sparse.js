// Locale holes are absent entries; explicit undefined is an invalid locale.
for (const locales of [[, "tr"], [, , "az"], new Array(3), [undefined, "tr"], [, undefined, "tr"]]) {
  for (const upper of [false, true]) {
    try {
      console.log(upper ? "i".toLocaleUpperCase(locales) : "I".toLocaleLowerCase(locales));
    } catch (error) {
      console.log(error.name);
    }
  }
}
