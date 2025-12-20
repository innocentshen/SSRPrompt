/*
  # 移除评价标准权重约束
  
  1. 修改
    - 移除 `evaluation_criteria.weight` 字段的 0-1 约束
    - 允许权重为任意正数，以支持更灵活的权重配置
  
  2. 说明
    - 移除了 CHECK (weight >= 0 AND weight <= 1) 约束
    - 权重现在只需要 >= 0，没有上限
    - 这样用户可以设置任意权重值来控制评价标准的重要性
*/

-- 删除现有的检查约束
ALTER TABLE evaluation_criteria 
DROP CONSTRAINT IF EXISTS evaluation_criteria_weight_check;

-- 修改列定义，移除约束并允许更大的数值范围
ALTER TABLE evaluation_criteria 
ALTER COLUMN weight TYPE numeric(5,2);

-- 添加新的检查约束，只检查非负
ALTER TABLE evaluation_criteria 
ADD CONSTRAINT evaluation_criteria_weight_check CHECK (weight >= 0);
