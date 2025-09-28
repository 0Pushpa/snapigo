// Objective-C only Apple Vision OCR bridge (no Swift / no bridging header)
const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const hdr = `
#import <React/RCTBridgeModule.h>
@interface OcrModule : NSObject <RCTBridgeModule>
@end
`;

const mm = `
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
      CGRect b = obs.boundingBox;
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
  // Write native files
  config = withDangerousMod(config, ['ios', (c) => {
    const iosRoot = c.modRequest.platformProjectRoot; // absolute path to ios/
    const modDir = path.join(iosRoot, 'NativeModules');
    if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);
    fs.writeFileSync(path.join(modDir, 'OcrModule.h'), hdr);
    fs.writeFileSync(path.join(modDir, 'OcrModule.mm'), mm);

    // If a Swift bridge/header from earlier exists, remove it to avoid PCH issues
    ['OcrModule.swift', 'Snapigo-Bridging-Header.h'].forEach(f => {
      const p = path.join(iosRoot, f.includes('OcrModule') ? 'NativeModules' : '', f);
      if (fs.existsSync(p)) try { fs.rmSync(p); } catch {}
    });

    return c;
  }]);

  // Add files to Xcode project + set friendly build flags
  config = withXcodeProject(config, (c) => {
    const project = c.modResults;
    const groupName = 'NativeModules';
    const group = project.pbxGroupByName(groupName) || project.addPbxGroup([], groupName, groupName);

    const add = (rel) => {
      if (!project.hasFile(rel)) {
        project.addSourceFile(rel, { target: project.getFirstTarget().uuid }, group.uuid);
      }
    };
    add('NativeModules/OcrModule.h');
    add('NativeModules/OcrModule.mm'); // Objective-C++

    // Ensure sandboxing is off for script phases (Expo/RN needs it)
    const cfgs = project.pbxXCBuildConfigurationSection();
    Object.keys(cfgs).forEach(k => {
      const cfg = cfgs[k];
      if (typeof cfg === 'object' && cfg.buildSettings) {
        cfg.buildSettings['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO';
        // Remove/neutralize Swift bridging header settings if any linger
        cfg.buildSettings['SWIFT_OBJC_BRIDGING_HEADER'] = '';
        cfg.buildSettings['SWIFT_PRECOMPILE_BRIDGING_HEADER'] = 'NO';
        // Ensure public headers are visible
        const hs = cfg.buildSettings['HEADER_SEARCH_PATHS'] || [];
        cfg.buildSettings['HEADER_SEARCH_PATHS'] = Array.from(new Set([].concat(hs, '"$(PODS_ROOT)/Headers/Public/**"')));
      }
    });

    return c;
  });

  return config;
};
