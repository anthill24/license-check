import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  detectLicense,
  identifyLicenseText,
  readManifest,
} from "../src/detect.js";
import { SAMPLE_PROJECT } from "./helpers.js";

const NM = join(SAMPLE_PROJECT, "node_modules");

describe("identifyLicenseText", () => {
  it("identifies MIT", () => {
    const text = `MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the Software without restriction...`;
    expect(identifyLicenseText(text)).toBe("MIT");
  });

  it("identifies Apache-2.0", () => {
    expect(identifyLicenseText("Apache License\nVersion 2.0, January 2004")).toBe(
      "Apache-2.0",
    );
  });

  it("identifies GPL-3.0 and GPL-2.0 by version", () => {
    expect(identifyLicenseText("GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007")).toBe(
      "GPL-3.0-only",
    );
    expect(identifyLicenseText("GNU GENERAL PUBLIC LICENSE\nVersion 2, June 1991")).toBe(
      "GPL-2.0-only",
    );
  });

  it("identifies AGPL", () => {
    expect(
      identifyLicenseText("GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007"),
    ).toBe("AGPL-3.0-only");
  });

  it("identifies LGPL", () => {
    expect(
      identifyLicenseText("GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007"),
    ).toBe("LGPL-3.0-only");
  });

  it("does NOT misclassify GPL-3.0 as AGPL when the body cross-references Affero", () => {
    // The real GPL-3.0 text references the GNU Affero GPL in section 13. The
    // GPL title appears first, so the result must still be GPL-3.0-only.
    const gpl3WithAfferoMention = [
      "GNU GENERAL PUBLIC LICENSE",
      "Version 3, 29 June 2007",
      "... (full terms) ...",
      "13. Use with the GNU Affero General Public License.",
      "Notwithstanding any other provision of this License, you have permission",
      "to link or combine any covered work with a work licensed under version 3",
      "of the GNU Affero General Public License into a single combined work...",
    ].join("\n");
    expect(identifyLicenseText(gpl3WithAfferoMention)).toBe("GPL-3.0-only");
  });

  it("identifies AGPL even though its body contains 'General Public License'", () => {
    const agpl = [
      "GNU AFFERO GENERAL PUBLIC LICENSE",
      "Version 3, 19 November 2007",
      "...based on the GNU General Public License...",
    ].join("\n");
    expect(identifyLicenseText(agpl)).toBe("AGPL-3.0-only");
  });

  it("identifies BSD-3-Clause vs BSD-2-Clause", () => {
    const bsd3 = `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: Neither the name of the copyright holder...`;
    const bsd2 = `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: 1. Redistributions of source code...`;
    expect(identifyLicenseText(bsd3)).toBe("BSD-3-Clause");
    expect(identifyLicenseText(bsd2)).toBe("BSD-2-Clause");
  });

  it("identifies ISC", () => {
    expect(
      identifyLicenseText("ISC License\n\nPermission to use, copy, modify, and/or distribute this software for any purpose..."),
    ).toBe("ISC");
  });

  it("identifies MPL-2.0", () => {
    expect(identifyLicenseText("Mozilla Public License Version 2.0")).toBe("MPL-2.0");
  });

  it("returns null for unrecognised text", () => {
    expect(identifyLicenseText("Some entirely custom license terms here.")).toBeNull();
  });
});

describe("readManifest", () => {
  it("reads a valid package.json", () => {
    const mf = readManifest(join(NM, "apache-pkg"));
    expect(mf?.name).toBe("apache-pkg");
    expect(mf?.license).toBe("Apache-2.0");
  });

  it("returns null for a missing directory", () => {
    expect(readManifest(join(NM, "does-not-exist"))).toBeNull();
  });
});

describe("detectLicense", () => {
  it("reads a string license field", () => {
    expect(detectLicense(join(NM, "apache-pkg"))).toEqual({
      license: "Apache-2.0",
      source: "package.json:license",
    });
  });

  it("reads the deprecated object form", () => {
    expect(detectLicense(join(NM, "deprecated-object-pkg"))).toEqual({
      license: "BSD-3-Clause",
      source: "package.json:license-object",
    });
  });

  it("reads the deprecated array form as an OR expression", () => {
    expect(detectLicense(join(NM, "deprecated-array-pkg"))).toEqual({
      license: "(MIT OR GPL-2.0-only)",
      source: "package.json:licenses",
    });
  });

  it("falls back to a LICENSE file (MIT)", () => {
    expect(detectLicense(join(NM, "license-file-only"))).toEqual({
      license: "MIT",
      source: "license-file",
    });
  });

  it("falls back to a LICENSE file (GPL)", () => {
    expect(detectLicense(join(NM, "gpl-file-pkg"))).toEqual({
      license: "GPL-3.0-only",
      source: "license-file",
    });
  });

  it("returns none when there is no license anywhere", () => {
    expect(detectLicense(join(NM, "no-license-pkg"))).toEqual({
      license: null,
      source: "none",
    });
  });

  it("reads the SEE LICENSE IN marker from the license field", () => {
    expect(detectLicense(join(NM, "see-license-pkg"))).toEqual({
      license: "SEE LICENSE IN LICENSE.custom",
      source: "package.json:license",
    });
  });

  it("prefers a passed manifest over re-reading disk", () => {
    const result = detectLicense("/nonexistent", { license: "MIT" });
    expect(result).toEqual({ license: "MIT", source: "package.json:license" });
  });
});
