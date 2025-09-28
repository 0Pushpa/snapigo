// plugins/with-apple-vision-ocr.js
// Apple Vision OCR native bridge (Objective-C++) for Expo/React Native.
// - Writes OcrModule.h / OcrModule.mm into ios/NativeModules
// - Adds them to the Xcode project
// - Disables Xcode 15 "User Script Sandboxing" so Expo/RN scripts can read Pods files
// - Ensures Pods public headers are visible
// No Swift. No bridging header. No Xcode clicking.

const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const HEADER_H = `
#import <React/RCTBridgeModule.h>
@interface OcrModule : NSObject <RCTBridgeModule>
@end
`;

const SOURCE_MM = `
#import "OcrModule.h"
#import <Vision/Vision.h>

@implementation OcrModule
RCT_EXPORT_MODULE();

RCT_REMAP_METHOD(recognize,
                 recognizeWithPath:(NSString *)imagePath
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *path = [imagePath hasPrefix:@"file://"] ? [imagePath substringFromIndex:7] : imagePath;
  NSURL *url = [NSURL fileURLWithPath:path];

  VNRecognizeTextRequest *req = [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest *r, NSError *e) {
    if (e) { reject(@"VISION_ERR", e.localizedDescription, e); return; }
    NSMutableArray *out = [NSMutableArray array];
    for (VNRecognizedTextObservation *obs in (NSArray<VNRecognizedTextObservation *> *)r.results) {
      VNRecognizedText *best = [[obs topCandidates:1] firstObject];
      if (!best) continue;
      CGRect b = obs.boundingBox; // normalized 0..1
      [out addObject:@{
        @"text": best.string ?: @"",
        @"bbox": @{@"x": @(b.origin.x), @"y": @(b.origin.y), @"w": @(b.size.width), @"h": @(b.size.height)}
      }];
    }
    resolve(out);
  }];
  req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  req.usesLanguageCorrection = YES;

  NSError *err = nil;
  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
  if (![handler performRequests:@[req] error:&err]) {
    reject(@"VISION_RUN_ERR", err.localizedDescription, err);
  }
}
@end
`;

module.exports = function withAppleVisionOCR(config) {
  // 1) Write native sources into ios/NativeModules (and remove any old Swift bridge if present)
  config = withDangerousMod(config, ['ios', (c) => {
    const iosRoot = c.modRequest.platformProjectRoot; // absolute path to ios/
    const modDir = path.join(iosRoot, 'NativeModules');
    if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);

    // Write Obj-C header/impl
    fs.writeFileSync(path.join(modDir, 'OcrModule.h'), HEADER_H);
    fs.writeFileSync(path.join(modDir, 'OcrModule.mm'), SOURCE_MM);

    // Clean up prior Swift attempt if it exists (not required, but avoids confusion)
    const swiftPath = path.join(modDir, 'OcrModule.swift');
    try { if (fs.existsSync(swiftPath)) fs.rmSync(swiftPath); } catch {}

    return c;
  }]);

  // 2) Add files to the Xcode project + set safe build settings
  config = withXcodeProject(config, (c) => {
    const project = c.modResults;

    // Ensure a logical group exists
    const groupName = 'NativeModules';
    const group = project.pbxGroupByName(groupName) || project.addPbxGroup([], groupName, groupName);

    // Add files to the target
    const add = (relPath) => {
      if (!project.hasFile(relPath)) {
        project.addSourceFile(relPath, { target: project.getFirstTarget().uuid }, group.uuid);
      }
    };
    add('NativeModules/OcrModule.h');
    add('NativeModules/OcrModule.mm'); // Objective-C++

    // Disable Xcode 15 user script sandboxing (lets Expo/RN scripts read Pods files)
    const cfgs = project.pbxXCBuildConfigurationSection();
    Object.keys(cfgs).forEach((k) => {
      const bs = cfgs[k] && cfgs[k].buildSettings;
      if (!bs) return;

      bs.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';

      // Ensure Pods public headers are visible (some RN setups need this)
      const PODS_HDR = '"$(PODS_ROOT)/Headers/Public/**"';
      if (!bs.HEADER_SEARCH_PATHS) {
        bs.HEADER_SEARCH_PATHS = PODS_HDR;
      } else if (Array.isArray(bs.HEADER_SEARCH_PATHS)) {
        if (!bs.HEADER_SEARCH_PATHS.includes(PODS_HDR)) bs.HEADER_SEARCH_PATHS.push(PODS_HDR);
      } else {
        bs.HEADER_SEARCH_PATHS = [bs.HEADER_SEARCH_PATHS, PODS_HDR];
      }

      // IMPORTANT: Do NOT touch any SWIFT_* bridging header keys here.
      // We keep this plugin Swift-free to avoid PCH/pcm cache issues.
    });

    return c;
  });

  return config;
};
