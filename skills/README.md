# 配套 skill（可选，但强烈建议装）

这两个 skill 是「抽卡工作台」的方法论那一半：插件负责**让你低负担地点**，
skill 负责**告诉 agent 怎么用这些标注**。两者合起来才闭环。

| skill | 作用 |
|---|---|
| `taste-calibration` | 抽卡式作者品味校准：怎么造"结构不同"的候选、怎么把选段转成证据、怎么在下一轮收敛 |
| `novel-writing` | 中文网文写作手艺：禁AI腔（六维度判定）、多视角信息差、术语与账目口径、克制留白 |

## 怎么装

dsh 从文件系统读 skill，放到下面任一处即可（project 级优先）：

```sh
# 只给这个作品用
mkdir -p <你的作品目录>/.dsh/skills
cp -r skills/taste-calibration skills/novel-writing <你的作品目录>/.dsh/skills/

# 或者给所有项目用
mkdir -p ~/.dsh/skills
cp -r skills/taste-calibration skills/novel-writing ~/.dsh/skills/
```

装完在会话里 agent 就能按 skill 的说明工作（例如「用 taste-calibration 的方式给我 8 个结构不同的候选」）。

## 出处

`skills/novel-writing/SKILL.md` 的「禁AI腔（六维度判定）」清单改编自
[dsh-novel-solo](https://github.com/Tkingxiao/dsh-novel-solo)（MIT，Copyright (c) 2026 Tkingxiao），
详见仓库根目录的 `THIRD_PARTY_NOTICES.md`。
