// node_modules/three/examples/jsm/loaders/usd/USDAParser.js
var DEF_MATCH_REGEX = /^def\s+(?:(\w+)\s+)?"?([^"]+)"?$/;
var VARIANT_STRING_REGEX = /^string\s+(\w+)$/;
var ATTR_MATCH_REGEX = /^(?:uniform\s+)?(\w+(?:\[\])?)\s+(.+)$/;
var USDAParser = class {
  parseText(text) {
    text = this._preprocess(text);
    const root = {};
    const lines = text.split("\n");
    let string = null;
    let target = root;
    const stack = [root];
    for (const line of lines) {
      if (line.includes("=")) {
        const eqIdx = this._findAssignmentOperator(line);
        if (eqIdx === -1) {
          string = line.trim();
          continue;
        }
        const lhs = line.slice(0, eqIdx).trim();
        const rhs = line.slice(eqIdx + 1).trim();
        if (rhs.endsWith("{")) {
          const group = {};
          stack.push(group);
          target[lhs] = group;
          target = group;
        } else if (rhs.endsWith("(")) {
          const values = rhs.slice(0, -1);
          target[lhs] = values;
          const meta = {};
          stack.push(meta);
          target = meta;
        } else {
          target[lhs] = rhs;
        }
      } else if (line.includes(":") && !line.includes("=")) {
        const colonIdx = line.indexOf(":");
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (/^[\d.]+$/.test(key)) {
          target[key] = value;
        }
      } else if (line.endsWith("{")) {
        const group = target[string] || {};
        stack.push(group);
        target[string] = group;
        target = group;
      } else if (line.endsWith("}")) {
        stack.pop();
        if (stack.length === 0) continue;
        target = stack[stack.length - 1];
      } else if (line.endsWith("(")) {
        const meta = {};
        stack.push(meta);
        string = line.split("(")[0].trim() || string;
        target[string] = meta;
        target = meta;
      } else if (line.endsWith(")")) {
        stack.pop();
        target = stack[stack.length - 1];
      } else if (line.trim()) {
        string = line.trim();
      }
    }
    return root;
  }
  _preprocess(text) {
    text = this._stripBlockComments(text);
    text = this._collapseTripleQuotedStrings(text);
    const lines = text.split("\n");
    const processed = [];
    let inMultilineValue = false;
    let bracketDepth = 0;
    let parenDepth = 0;
    let accumulated = "";
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      line = this._stripInlineComment(line);
      const trimmed = line.trim();
      if (inMultilineValue) {
        accumulated += " " + trimmed;
        for (const ch of trimmed) {
          if (ch === "[") bracketDepth++;
          else if (ch === "]") bracketDepth--;
          else if (ch === "(" && bracketDepth > 0) parenDepth++;
          else if (ch === ")" && bracketDepth > 0) parenDepth--;
        }
        if (bracketDepth === 0 && parenDepth === 0) {
          processed.push(accumulated);
          accumulated = "";
          inMultilineValue = false;
        }
      } else {
        if (trimmed.includes("=")) {
          const eqIdx = this._findAssignmentOperator(trimmed);
          if (eqIdx !== -1) {
            const rhs = trimmed.slice(eqIdx + 1).trim();
            let openBrackets = 0;
            let closeBrackets = 0;
            for (const ch of rhs) {
              if (ch === "[") openBrackets++;
              else if (ch === "]") closeBrackets++;
            }
            if (openBrackets > closeBrackets) {
              inMultilineValue = true;
              bracketDepth = openBrackets - closeBrackets;
              parenDepth = 0;
              accumulated = trimmed;
              continue;
            }
          }
        }
        processed.push(trimmed);
      }
    }
    return processed.join("\n");
  }
  _stripBlockComments(text) {
    let result = "";
    let i = 0;
    while (i < text.length) {
      if (text[i] === "/" && i + 1 < text.length && text[i + 1] === "*") {
        let j = i + 2;
        while (j < text.length) {
          if (text[j] === "*" && j + 1 < text.length && text[j + 1] === "/") {
            j += 2;
            break;
          }
          j++;
        }
        i = j;
      } else {
        result += text[i];
        i++;
      }
    }
    return result;
  }
  _collapseTripleQuotedStrings(text) {
    let result = "";
    let i = 0;
    while (i < text.length) {
      if (i + 2 < text.length) {
        const triple = text.slice(i, i + 3);
        if (triple === "'''" || triple === '"""') {
          const quoteChar = triple;
          result += quoteChar;
          i += 3;
          while (i < text.length) {
            if (i + 2 < text.length && text.slice(i, i + 3) === quoteChar) {
              result += quoteChar;
              i += 3;
              break;
            } else {
              if (text[i] === "\n") {
                result += "\\n";
              } else if (text[i] !== "\r") {
                result += text[i];
              }
              i++;
            }
          }
          continue;
        }
      }
      result += text[i];
      i++;
    }
    return result;
  }
  _stripInlineComment(line) {
    if (line.trim().startsWith("#usda")) return line;
    let inString = false;
    let stringChar = null;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (!inString && (ch === '"' || ch === "'")) {
        inString = true;
        stringChar = ch;
      } else if (inString && ch === stringChar) {
        inString = false;
        stringChar = null;
      } else if (!inString && ch === "#") {
        return line.slice(0, i).trimEnd();
      }
    }
    return line;
  }
  _findAssignmentOperator(line) {
    let inString = false;
    let stringChar = null;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (!inString && (ch === '"' || ch === "'")) {
        inString = true;
        stringChar = ch;
      } else if (inString && ch === stringChar) {
        inString = false;
        stringChar = null;
      } else if (!inString && ch === "=") {
        return i;
      }
    }
    return -1;
  }
  /**
   * Parse USDA text and return raw spec data in specsByPath format.
   * Used by USDComposer for unified scene composition.
   */
  parseData(text) {
    const root = this.parseText(text);
    const specsByPath = {};
    const SpecType = {
      Attribute: 1,
      Prim: 6,
      Relationship: 8
    };
    const rootFields = {};
    if ("#usda 1.0" in root) {
      const header = root["#usda 1.0"];
      if (header.upAxis) {
        rootFields.upAxis = header.upAxis.replace(/"/g, "");
      }
      if (header.defaultPrim) {
        rootFields.defaultPrim = header.defaultPrim.replace(/"/g, "");
      }
      if (header.metersPerUnit !== void 0) {
        rootFields.metersPerUnit = parseFloat(header.metersPerUnit);
      }
    }
    specsByPath["/"] = { specType: SpecType.Prim, fields: rootFields };
    const walkTree = (data, parentPath) => {
      const primChildren = [];
      for (const key in data) {
        if (key === "#usda 1.0") continue;
        if (key === "variants") continue;
        const defMatch = key.match(DEF_MATCH_REGEX);
        if (defMatch) {
          const typeName = defMatch[1] || "";
          const name = defMatch[2];
          const path = parentPath === "/" ? "/" + name : parentPath + "/" + name;
          primChildren.push(name);
          const primFields = { typeName };
          const primData = data[key];
          this._extractPrimData(primData, path, primFields, specsByPath, SpecType);
          specsByPath[path] = { specType: SpecType.Prim, fields: primFields };
          walkTree(primData, path);
        }
      }
      if (primChildren.length > 0 && specsByPath[parentPath]) {
        specsByPath[parentPath].fields.primChildren = primChildren;
      }
    };
    walkTree(root, "/");
    return { specsByPath };
  }
  _extractPrimData(data, path, primFields, specsByPath, SpecType) {
    if (!data || typeof data !== "object") return;
    for (const key in data) {
      if (key.startsWith("def ")) continue;
      if (key === "prepend references") {
        primFields.references = [data[key]];
        continue;
      }
      if (key === "payload") {
        primFields.payload = data[key];
        continue;
      }
      if (key === "variants") {
        const variantSelection = {};
        const variants = data[key];
        for (const vKey in variants) {
          const match = vKey.match(VARIANT_STRING_REGEX);
          if (match) {
            const variantSetName = match[1];
            const variantValue = variants[vKey].replace(/"/g, "");
            variantSelection[variantSetName] = variantValue;
          }
        }
        if (Object.keys(variantSelection).length > 0) {
          primFields.variantSelection = variantSelection;
        }
        continue;
      }
      if (key.startsWith("rel ")) {
        const relName = key.slice(4);
        const relPath = path + "." + relName;
        const target = data[key].replace(/[<>]/g, "");
        specsByPath[relPath] = {
          specType: SpecType.Relationship,
          fields: { targetPaths: [target] }
        };
        continue;
      }
      if (key.includes("xformOpOrder")) {
        const ops = data[key].replace(/[\[\]]/g, "").split(",").map((s) => s.trim().replace(/"/g, ""));
        primFields.xformOpOrder = ops;
        continue;
      }
      const attrMatch = key.match(ATTR_MATCH_REGEX);
      if (attrMatch) {
        const valueType = attrMatch[1];
        const attrName = attrMatch[2];
        const rawValue = data[key];
        if (attrName.endsWith(".connect")) {
          const baseAttrName = attrName.slice(0, -8);
          const attrPath = path + "." + baseAttrName;
          let connPath = String(rawValue).trim();
          if (connPath.startsWith("<")) connPath = connPath.slice(1);
          if (connPath.endsWith(">")) connPath = connPath.slice(0, -1);
          if (!specsByPath[attrPath]) {
            specsByPath[attrPath] = {
              specType: SpecType.Attribute,
              fields: { typeName: valueType }
            };
          }
          specsByPath[attrPath].fields.connectionPaths = [connPath];
          continue;
        }
        if (attrName.endsWith(".timeSamples") && typeof rawValue === "object") {
          const baseAttrName = attrName.slice(0, -12);
          const attrPath = path + "." + baseAttrName;
          const times = [];
          const values = [];
          for (const frameKey in rawValue) {
            const frame = parseFloat(frameKey);
            if (isNaN(frame)) continue;
            times.push(frame);
            values.push(this._parseAttributeValue(valueType, rawValue[frameKey]));
          }
          const sorted = times.map((t, i) => ({ t, v: values[i] })).sort((a, b) => a.t - b.t);
          specsByPath[attrPath] = {
            specType: SpecType.Attribute,
            fields: {
              timeSamples: { times: sorted.map((s) => s.t), values: sorted.map((s) => s.v) },
              typeName: valueType
            }
          };
        } else {
          const parsedValue = this._parseAttributeValue(valueType, rawValue);
          const attrPath = path + "." + attrName;
          specsByPath[attrPath] = {
            specType: SpecType.Attribute,
            fields: { default: parsedValue, typeName: valueType }
          };
        }
      }
    }
  }
  _parseAttributeValue(valueType, rawValue) {
    if (rawValue === void 0 || rawValue === null) return void 0;
    const str = String(rawValue).trim();
    if (valueType.endsWith("[]")) {
      try {
        let cleaned = str.replace(/\(/g, "[").replace(/\)/g, "]");
        if (cleaned.endsWith(",")) cleaned = cleaned.slice(0, -1);
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
          return parsed.flat();
        }
        return parsed;
      } catch (e) {
        const cleaned = str.replace(/[\[\]]/g, "");
        return cleaned.split(",").map((s) => {
          const trimmed = s.trim();
          const num = parseFloat(trimmed);
          return isNaN(num) ? trimmed.replace(/"/g, "") : num;
        });
      }
    }
    if (valueType.includes("3") || valueType.includes("2") || valueType.includes("4")) {
      const cleaned = str.replace(/[()]/g, "");
      const values = cleaned.split(",").map((s) => parseFloat(s.trim()));
      return values;
    }
    if (valueType.startsWith("quat")) {
      const cleaned = str.replace(/[()]/g, "");
      const values = cleaned.split(",").map((s) => parseFloat(s.trim()));
      return [values[1], values[2], values[3], values[0]];
    }
    if (valueType.includes("matrix")) {
      const cleaned = str.replace(/[()]/g, "");
      const values = cleaned.split(",").map((s) => parseFloat(s.trim()));
      return values;
    }
    if (valueType === "float" || valueType === "double" || valueType === "int") {
      return parseFloat(str);
    }
    if (valueType === "string" || valueType === "token") {
      return this._parseString(str);
    }
    if (valueType === "asset") {
      return str.replace(/@/g, "").replace(/"/g, "");
    }
    return this._parseString(str);
  }
  _parseString(str) {
    if (str.startsWith('"') && str.endsWith('"') || str.startsWith("'") && str.endsWith("'")) {
      str = str.slice(1, -1);
    }
    let result = "";
    let i = 0;
    while (i < str.length) {
      if (str[i] === "\\" && i + 1 < str.length) {
        const next = str[i + 1];
        switch (next) {
          case "n":
            result += "\n";
            break;
          case "t":
            result += "	";
            break;
          case "r":
            result += "\r";
            break;
          case "\\":
            result += "\\";
            break;
          case '"':
            result += '"';
            break;
          case "'":
            result += "'";
            break;
          default:
            result += next;
            break;
        }
        i += 2;
      } else {
        result += str[i];
        i++;
      }
    }
    return result;
  }
};

export {
  USDAParser
};
//# sourceMappingURL=chunk-UFASA7K4.js.map
