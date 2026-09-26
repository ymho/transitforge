from pathlib import Path
import json
import subprocess

p = Path('modules/agent/runtime/agent-v2-publication.test.ts')
s = p.read_text()
old = '''    for (const commentary of ["<thinking>hidden</thinking>", "x".repeat(1201), "  surrounding whitespace"]) {
      expect(() => parseAgentV2Reply({ ...proposal, commentary })).toThrow("invalid_proposal");
    }'''
new = '''    // Syntax limits and publication safety are different boundaries.
    expect(() => parseAgentV2Reply({ ...proposal, commentary: "x".repeat(1201) })).toThrow("invalid_proposal");
    expect(() => admitAgentV2Reply({ ...proposal, commentary: "<thinking>hidden</thinking>" }, context())).toThrow("unsafe_content");
    // Leading whitespace is not a security or factuality failure.
    expect(admitAgentV2Reply({ ...proposal, commentary: "  surrounding whitespace" }, context()).text).toContain("surrounding whitespace");'''
assert old in s
s = s.replace(old, new)
old = 'expect(() => parseAgentV2Reply({ ...proposal, references: [...proposal.references, ...proposal.references] })).toThrow("invalid_proposal");'
new = 'expect(() => admitAgentV2Reply({ ...proposal, references: [...proposal.references, ...proposal.references] }, context())).toThrow("invalid_proposal");'
assert old in s
p.write_text(s.replace(old, new))

# Keep the lockfile's unrelated dependency graph byte-for-byte equivalent.
base = subprocess.check_output(['git', 'show', 'bf291769f9f093777a9fa7679ddac1be854bb140:package-lock.json'], text=True)
lock = json.loads(base)
manifest = json.loads(Path('modules/agent/package.json').read_text())
lock['packages']['modules/agent']['dependencies']['zod'] = manifest['dependencies']['zod']
Path('package-lock.json').write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n')

p = Path('backend/agent-api/src/composition/strands-output-live.test.ts')
s = p.read_text()
s = s.replace('model: v1, weather: { search: vi.fn() }, newExecutionId:', '''diagnostics: { record: async ({ phase, reason, mode }) => { console.log(JSON.stringify({ phase, reason, mode })); } },
      model: v1, weather: { search: vi.fn() }, newExecutionId:''')
p.write_text(s)

p = Path('backend/agent-api/src/adapters/strands-agent-engine.ts')
s = p.read_text().replace('Do not call this for unchanged conversation after the final structured result.', 'Do not call this for unchanged conversation or after the final structured result.')
p.write_text(s)
print('Updated acceptance boundaries; restored the unrelated lockfile graph.')
