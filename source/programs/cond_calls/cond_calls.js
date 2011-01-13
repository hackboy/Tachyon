/**
@fileOverview
This test is meant to ensure that values are correctly merged after 
conditionals and that local variable values are properly preserved across
calls.

@copyright
Copyright (c) 2010-2011 Tachyon Javascript Engine, All Rights Reserved
*/

function bar(v)
{
    return v + 1;
}

function bif(v)
{
    return v + 2;
}

function foo(a)
{
    var b = 3;

    if (a === 1)
    {
        // b += 4
        b += bar(b);
    }
    else
    {
        // b += 5
        b += bif(b);
    }

    b += 1;

    return a + b;
}

function fee()
{
    // 9 + 11 === 20
    return foo(1) + foo(2);
}

return fee();
