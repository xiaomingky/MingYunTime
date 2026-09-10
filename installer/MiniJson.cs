using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace MingYunInstaller
{
    /// <summary>
    /// 极简 JSON 解析器（无第三方依赖，Win7 全兼容）。
    /// 输出对象图为 Dictionary&lt;string,object&gt; / List&lt;object&gt; / string / double / bool / null，
    /// 与 JavaScriptSerializer 结构一致，但只依赖 mscorlib/System。
    /// </summary>
    public static class MiniJson
    {
        sealed class Reader
        {
            readonly string s;
            int i;
            public Reader(string input) { s = input; i = 0; }

            public object ParseValue()
            {
                SkipWs();
                if (i >= s.Length) return null;
                char c = s[i];
                switch (c)
                {
                    case '{': return ParseObject();
                    case '[': return ParseArray();
                    case '"': return ParseString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default: return ParseNumber();
                }
            }

            Dictionary<string, object> ParseObject()
            {
                var d = new Dictionary<string, object>();
                i++; // {
                SkipWs();
                if (i < s.Length && s[i] == '}') { i++; return d; }
                while (true)
                {
                    SkipWs();
                    string key = ParseString();
                    SkipWs();
                    if (i < s.Length && s[i] == ':') i++;
                    object val = ParseValue();
                    d[key] = val;
                    SkipWs();
                    if (i >= s.Length) break;
                    char c = s[i++];
                    if (c == '}') break;
                }
                return d;
            }

            List<object> ParseArray()
            {
                var list = new List<object>();
                i++; // [
                SkipWs();
                if (i < s.Length && s[i] == ']') { i++; return list; }
                while (true)
                {
                    list.Add(ParseValue());
                    SkipWs();
                    if (i >= s.Length) break;
                    char c = s[i++];
                    if (c == ']') break;
                }
                return list;
            }

            string ParseString()
            {
                i++; // "
                var sb = new StringBuilder();
                while (i < s.Length)
                {
                    char c = s[i++];
                    if (c == '"') break;
                    if (c == '\\')
                    {
                        if (i >= s.Length) break;
                        char e = s[i++];
                        switch (e)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (i + 4 <= s.Length)
                                {
                                    ushort cp;
                                    if (ushort.TryParse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out cp))
                                    {
                                        sb.Append((char)cp);
                                        i += 4;
                                    }
                                }
                                break;
                            default: sb.Append(e); break;
                        }
                    }
                    else sb.Append(c);
                }
                return sb.ToString();
            }

            object ParseNumber()
            {
                int start = i;
                while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
                string tok = s.Substring(start, i - start);
                double d;
                if (double.TryParse(tok, NumberStyles.Float, CultureInfo.InvariantCulture, out d))
                    return d;
                return 0.0;
            }

            void Expect(string word)
            {
                if (i + word.Length <= s.Length && s.Substring(i, word.Length) == word) i += word.Length;
            }

            void SkipWs()
            {
                while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n')) i++;
            }
        }

        /// <summary>解析任意 JSON 文档</summary>
        public static object Parse(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            return new Reader(json.TrimStart('\uFEFF', ' ', '\r', '\n')).ParseValue();
        }

        /// <summary>安全取 Dictionary 字符串值</summary>
        public static string Str(Dictionary<string, object> d, string key)
        {
            if (d == null || !d.ContainsKey(key)) return null;
            var v = d[key];
            if (v == null) return null;
            if (v is string) return (string)v;
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }
    }
}