# Squish — Apple and Android icon packages

## Apple (iOS / iPadOS)

Drag `apple/AppIcon.appiconset` into your Xcode asset catalog. Select AppIcon as the target's App Icons Source. The catalog contains 1024 × 1024 default, dark and grayscale tinted appearances and Contents.json. PNGs are opaque with no alpha and no pre-rounded corners. Xcode generates runtime sizes using the single-size iOS asset catalog configuration.

`apple/app-store-icon-1024.png` is the default store image. `apple/exports/` supplies common explicit raster sizes for older/manual pipelines. These extra files are not additional Xcode catalog slots.

`apple/IconComposer-sources/` provides separate 1024px foreground and background PNGs for importing into Apple's Icon Composer. These are source layers, not a compiled .icon document. Clear/Liquid Glass appearances have not been authored or tested. This package targets iOS/iPadOS, not a macOS .icns bundle.

## Android

Merge `android/res/` into your application's `app/src/main/res/`. Review existing files with the same names before replacing them.

In the existing application element of AndroidManifest.xml, use:

```xml
android:icon="@mipmap/ic_launcher"
android:roundIcon="@mipmap/ic_launcher_round"
```

Included:
- Legacy standard and round launcher icons at 48, 72, 96, 144 and 192px.
- Transparent foreground and monochrome layers at 108, 162, 216, 324 and 432px, corresponding to 108dp at mdpi through xxxhdpi.
- `mipmap-anydpi-v26` adaptive icon XML with foreground and full-bleed background colour.
- `mipmap-anydpi-v33` XML with a monochrome layer for themed icons. Compile with SDK 33 or newer to use this resource set.
- `values/squish_icon_colors.xml`, defining lavender #C9BEFF.
- 512 × 512 Google Play PNG under `android/store/`.
- 432px standalone foreground and monochrome masters under `android/layers/`.

The monochrome layer encodes the character and facial cutouts in alpha. Android supplies the wallpaper/theme colours. It is intentionally not a coloured background tile.

Adaptive content is centred within the platform's safe area, with no baked corner mask or outline shadow. Only the explicitly named legacy round fallback is pre-masked; the adaptive layers remain unmasked.

## Checks

Images were rendered and inspected. The adaptive foreground alpha bounds fit inside a centred 66dp-diameter circle (132px radius at xxxhdpi); see validation.json. Apple PNG dimensions and absence of alpha were checked. Catalog JSON and Android XML were parsed. Xcode/Android native builds and device launcher tests have not been run in this projectless workspace.

## Official references checked

- https://developer.apple.com/documentation/xcode/configuring-your-app-icon
- https://developer.apple.com/design/human-interface-guidelines/app-icons
- https://developer.android.com/develop/ui/compose/system/icon_design_adaptive
