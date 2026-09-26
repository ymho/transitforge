from pathlib import Path

p = Path('tools/check_architecture_boundaries.mjs')
s = p.read_text()
old = ': /^@raiquora\\/(agent|trip|journey|operation|train)\\//u.test(imported.specifier);'
new = ': imported.specifier === "zod" || /^@raiquora\\/(agent|trip|journey|operation|train)\\//u.test(imported.specifier);'
assert s.count(old) == 1
s = s.replace(old, new)
s = s.replace('const agentRuntimeRoot = resolve(modulesRoot, "agent/runtime");',
'''// ADR 0097: Zod is a portable, I/O-free contract/schema dependency, not an
// execution/provider implementation. Keep AWS/Strands/Frontend/Backend forbidden.
const agentRuntimeRoot = resolve(modulesRoot, "agent/runtime");''')
s = s.replace('Agent coreは共有契約以外のFrontend/Backend/Vendor実装へ依存できません',
              'Agent coreは共有契約とZod schema以外のFrontend/Backend/Vendor実装へ依存できません')
p.write_text(s)
print('Allowed portable Zod contract validation without allowing Provider or UI dependencies.')
